import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@/config/env.validation';
import type { SmsDeliveryTracker } from '@/infra/sms/sms-delivery-tracker';
import type { SmsDeliveryStatus, SmsSendInput, SmsSendResult } from '@/infra/sms/sms.types';
import type { ProfileService } from '../profile/profile.service';
import type { EmergencyContactRecord } from '../profile/infrastructure/contact.repository';
import type { SosRepository, StartOutcome } from './infrastructure/sos.repository';
import { SosService } from './sos.service';
import type { StartSosDto } from './sos.dto';
import type { SosRecord } from './sos.types';

const UID = 'user-1';
const REQUEST_ID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';

// In-memory stand-in for the Firestore repository with the same contract.
class FakeSosRepository {
  records = new Map<string, SosRecord>();
  requests = new Map<string, { sosId: string; fingerprint: string }>();
  active = new Map<string, string>();
  private counter = 0;

  newId(): string {
    this.counter += 1;
    return `sos-${this.counter}`;
  }

  findByRequest(uid: string, requestId: string) {
    const mapping = this.requests.get(`${uid}_${requestId}`);
    const record = mapping && this.records.get(mapping.sosId);
    return Promise.resolve(record ? { record, fingerprint: mapping.fingerprint } : null);
  }

  get(sosId: string) {
    return Promise.resolve(this.records.get(sosId) ?? null);
  }

  listPage(afterId?: string) {
    return Promise.resolve(
      [...this.records.values()]
        .sort((a, b) => a.sosId.localeCompare(b.sosId))
        .filter((record) => !afterId || record.sosId > afterId)
        .slice(0, 100),
    );
  }

  getActive(uid: string) {
    const id = this.active.get(uid);
    const record = id ? this.records.get(id) : undefined;
    return Promise.resolve(record?.status === 'active' ? record : null);
  }

  startOrGet(
    uid: string,
    requestId: string,
    fingerprint: string,
    candidate: SosRecord,
  ): Promise<StartOutcome> {
    const key = `${uid}_${requestId}`;
    const mapped = this.requests.get(key);
    if (mapped) {
      return Promise.resolve(
        mapped.fingerprint !== fingerprint
          ? { kind: 'conflict' }
          : { kind: 'existing', record: this.records.get(mapped.sosId)! },
      );
    }
    const activeId = this.active.get(uid);
    const activeRecord = activeId ? this.records.get(activeId) : undefined;
    if (activeRecord?.status === 'active') {
      this.requests.set(key, { sosId: activeRecord.sosId, fingerprint });
      return Promise.resolve({ kind: 'existing', record: activeRecord });
    }
    this.records.set(candidate.sosId, candidate);
    this.active.set(uid, candidate.sosId);
    this.requests.set(key, { sosId: candidate.sosId, fingerprint });
    return Promise.resolve({ kind: 'created', record: candidate });
  }

  mutate<T>(sosId: string, change: (record: SosRecord) => T) {
    const record = this.records.get(sosId);
    return Promise.resolve(record ? change(record) : null);
  }

  mutateAndRelease<T>(uid: string, sosId: string, change: (record: SosRecord) => T) {
    const record = this.records.get(sosId);
    if (!record) return Promise.resolve(null);
    const result = change(record);
    if (this.active.get(uid) === sosId) this.active.delete(uid);
    return Promise.resolve(result);
  }
}

const contact = (id: string, phone: string, name = `Contact ${id}`): EmergencyContactRecord => ({
  id,
  uid: UID,
  name,
  phone,
  relationship: 'Friend',
  photo_url: null,
  public_id: null,
});

type Harness = {
  service: SosService;
  repo: FakeSosRepository;
  sent: SmsSendInput[];
  send: jest.Mock<Promise<SmsSendResult>, [SmsSendInput]>;
  track: jest.Mock<Promise<SmsDeliveryStatus>, [string]>;
};

function build(
  options: {
    enabled?: boolean;
    timeoutMs?: number;
    contacts?: EmergencyContactRecord[];
    send?: (input: SmsSendInput) => Promise<SmsSendResult>;
    track?: SmsDeliveryStatus;
  } = {},
): Harness {
  const repo = new FakeSosRepository();
  const sent: SmsSendInput[] = [];
  const send = jest.fn((input: SmsSendInput) => {
    sent.push(input);
    return options.send
      ? options.send(input)
      : Promise.resolve<SmsSendResult>({ outcome: 'accepted', providerMessageId: 'batch-1' });
  });
  const track = jest.fn<Promise<SmsDeliveryStatus>, [string]>(() =>
    Promise.resolve<SmsDeliveryStatus>(options.track ?? { state: 'sent' }),
  );
  const profileService = {
    listContacts: jest.fn(() =>
      Promise.resolve(
        options.contacts ?? [contact('a', '+639111111111'), contact('b', '+639222222222')],
      ),
    ),
    getProfile: jest.fn(() =>
      Promise.resolve({ personalInfo: { firstName: 'Maria', lastName: 'Santos' } }),
    ),
  } as unknown as ProfileService;
  const config = {
    get: jest.fn((key: string) =>
      key === 'SOS_ENABLED' ? (options.enabled ?? true) : (options.timeoutMs ?? 10000),
    ),
  } as unknown as ConfigService<EnvironmentVariables, true>;

  const service = new SosService(
    repo as unknown as SosRepository,
    profileService,
    { send },
    { track } as unknown as SmsDeliveryTracker,
    config,
  );
  return { service, repo, sent, send, track };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

const dto = (overrides: Partial<StartSosDto> = {}): StartSosDto => ({
  requestId: REQUEST_ID,
  ...overrides,
});

describe('SosService', () => {
  beforeEach(() => {
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });
  afterEach(() => jest.restoreAllMocks());

  describe('crash recovery', () => {
    function seed(
      repo: FakeSosRepository,
      options: {
        initial?: SosRecord['recipients'][number]['initial']['status'];
        ended?: SosRecord['recipients'][number]['initial']['status'];
        age?: number;
        endedAge?: number;
        stopped?: boolean;
        id?: string;
      } = {},
    ): SosRecord {
      const createdAt = new Date(Date.now() - (options.age ?? 121000)).toISOString();
      const record: SosRecord = {
        sosId: options.id ?? 'recovery-1',
        uid: UID,
        requestId: REQUEST_ID,
        status: options.stopped ? 'ended' : 'active',
        requesterName: 'Test user',
        createdAt,
        endedAt: options.stopped ? createdAt : null,
        location: null,
        recipients: [
          {
            contactId: 'a',
            name: 'Contact',
            phone: contact('a', '+639111111111').phone,
            initial: { status: options.initial ?? 'queued', updatedAt: createdAt },
            ended: options.ended
              ? {
                  status: options.ended,
                  updatedAt: new Date(
                    Date.now() - (options.endedAge ?? options.age ?? 121000),
                  ).toISOString(),
                }
              : null,
          },
        ],
      };
      repo.records.set(record.sosId, record);
      return record;
    }

    it('expires stale queued initial jobs without sending', async () => {
      const { service, repo, send } = build();
      const record = seed(repo);
      await service.recover();
      expect(record.recipients[0].initial).toMatchObject({
        status: 'failed',
        errorCode: 'expired',
      });
      expect(send).not.toHaveBeenCalled();
      expect(record.status).toBe('active');
    });

    it('marks interrupted initial and end sends unknown and never resends them', async () => {
      const { service, repo, send } = build();
      const record = seed(repo, { initial: 'sending', ended: 'sending', stopped: true });
      await service.recover();
      await service.recover();
      for (const summary of [record.recipients[0].initial, record.recipients[0].ended]) {
        expect(summary).toMatchObject({ status: 'unknown', errorCode: 'interrupted' });
      }
      expect(send).not.toHaveBeenCalled();
    });

    it('does not interrupt a fresh sending claim from another process', async () => {
      const { service, repo, send } = build();
      const record = seed(repo, { initial: 'sending', age: 1000 });
      await service.recover();
      expect(record.recipients[0].initial.status).toBe('sending');
      expect(send).not.toHaveBeenCalled();
    });

    it('waits longer than the configured provider timeout before declaring an interruption', async () => {
      const { service, repo, send } = build({ timeoutMs: 120000 });
      const record = seed(repo, { initial: 'sending', age: 45000 });
      await service.recover();
      expect(record.recipients[0].initial.status).toBe('sending');
      record.recipients[0].initial.updatedAt = new Date(Date.now() - 151000).toISOString();
      await service.recover();
      expect(record.recipients[0].initial.status).toBe('unknown');
      expect(send).not.toHaveBeenCalled();
    });

    it('resumes a fresh queued initial job once across competing recovery passes', async () => {
      const { service, repo, send } = build();
      const record = seed(repo, { age: 1000 });
      const other = new SosService(
        repo as unknown as SosRepository,
        {} as ProfileService,
        { send },
        { track: jest.fn() } as unknown as SmsDeliveryTracker,
        {
          get: (key: string) => (key === 'SOS_ENABLED' ? true : 10000),
        } as unknown as ConfigService<EnvironmentVariables, true>,
      );
      await Promise.all([service.recover(), other.recover()]);
      await service.recover();
      expect(send).toHaveBeenCalledTimes(1);
      expect(record.recipients[0].initial.status).toBe('accepted');
    });

    it('expires queued end updates even on ended records', async () => {
      const { service, repo, send } = build();
      const record = seed(repo, { initial: 'accepted', ended: 'queued', stopped: true });
      await service.recover();
      expect(record.recipients[0].ended).toMatchObject({ status: 'failed', errorCode: 'expired' });
      expect(send).not.toHaveBeenCalled();
    });

    it('uses end-job creation time when a late initial result needs a follow-up', async () => {
      const { service, repo, send } = build();
      const record = seed(repo, {
        initial: 'unknown',
        ended: 'queued',
        stopped: true,
        endedAge: 1000,
      });
      await service.recover();
      await service.recover();
      expect(send).toHaveBeenCalledTimes(1);
      expect(record.recipients[0].initial.status).toBe('unknown');
      expect(record.recipients[0].ended?.status).toBe('accepted');
    });

    it('creates one end update after recovering an interrupted initial on a stopped SOS', async () => {
      const { service, repo, send } = build();
      const record = seed(repo, { initial: 'sending', stopped: true });
      await service.recover();
      await service.recover();
      expect(record.recipients[0].initial.status).toBe('unknown');
      expect(record.recipients[0].ended?.status).toBe('accepted');
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('cancels queued initial sends on an ended SOS', async () => {
      const { service, repo, send } = build();
      const record = seed(repo, { stopped: true, age: 1000 });
      await service.recover();
      expect(record.recipients[0].initial.status).toBe('cancelled');
      expect(send).not.toHaveBeenCalled();
    });

    it('repairs a missing end job after a persisted unknown initial result', async () => {
      const { service, repo, send } = build();
      const record = seed(repo, { initial: 'unknown', stopped: true });
      await service.recover();
      await service.recover();
      expect(record.recipients[0].initial.status).toBe('unknown');
      expect(record.recipients[0].ended?.status).toBe('accepted');
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('keeps an initial job eligible at exactly the two-minute boundary', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.now());
      const { service, repo, send } = build();
      seed(repo, { age: 120000 });
      await service.recover();
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('keeps a queued end update waiting while the initial is sending', async () => {
      const { service, repo, send } = build();
      const record = seed(repo, { initial: 'sending', ended: 'queued', stopped: true, age: 1000 });
      await service.recover();
      expect(record.recipients[0].ended?.status).toBe('queued');
      expect(send).not.toHaveBeenCalled();
    });

    it('does not scan, start a timer, or send when disabled', async () => {
      const { service, repo, send } = build({ enabled: false });
      const list = jest.spyOn(repo, 'listPage');
      const timer = jest.spyOn(global, 'setInterval');
      const record = seed(repo, { age: 1000 });
      service.onModuleInit();
      await service.recover();
      await service.stop(UID, record.sosId);
      expect(list).not.toHaveBeenCalled();
      expect(timer).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });

    it('runs at startup and periodically and clears its timer on shutdown', () => {
      jest.useFakeTimers();
      try {
        const { service } = build();
        const recover = jest.spyOn(service, 'recover').mockResolvedValue();
        service.onModuleInit();
        expect(recover).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(30000);
        expect(recover).toHaveBeenCalledTimes(2);
        service.onModuleDestroy();
        jest.advanceTimersByTime(30000);
        expect(recover).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('continues past a record failure and retries failed scans on the next pass', async () => {
      const { service, repo } = build();
      seed(repo, { id: 'a' });
      const second = seed(repo, { id: 'b' });
      jest.spyOn(repo, 'mutate').mockImplementationOnce(() => Promise.reject(new Error('failure')));
      const list = jest.spyOn(repo, 'listPage').mockRejectedValueOnce(new Error('failure'));
      await service.recover();
      await service.recover();
      expect(list).toHaveBeenCalled();
      expect(second.recipients[0].initial.status).toBe('failed');
    });

    it('pages past 100 records so old completed records cannot hide pending work', async () => {
      const { service, repo } = build();
      for (let i = 0; i < 101; i += 1)
        seed(repo, { id: `record-${String(i).padStart(3, '0')}`, initial: 'accepted' });
      const pending = seed(repo, { id: 'z-pending' });
      await service.recover();
      expect(pending.recipients[0].initial.status).toBe('failed');
    });
  });

  describe('start', () => {
    it('creates an SOS, sends one SMS per recipient and reports accepted', async () => {
      const { service, sent } = build();

      const { sos, created } = await service.start(UID, dto());
      await flush();

      expect(created).toBe(true);
      expect(sent.map((s) => s.recipient)).toEqual(['+639111111111', '+639222222222']);
      const after = await service.getOwned(UID, sos.sosId);
      expect(after.recipients.map((r) => r.initial.status)).toEqual(['accepted', 'accepted']);
    });

    it('never exposes full phone numbers, uid or provider ids', async () => {
      const { service } = build();

      const { sos } = await service.start(UID, dto());
      await flush();
      const json = JSON.stringify(await service.getOwned(UID, sos.sosId));

      expect(json).not.toContain('+639111111111');
      expect(json).toContain('+639******111');
      expect(json).not.toContain(UID);
      expect(json).not.toContain('batch-1');
      expect(json).not.toContain('Maria');
    });

    it('deduplicates by phone, keeping the lowest contact id', async () => {
      const { service, sent } = build({
        contacts: [contact('b', '+639111111111'), contact('a', '+639111111111')],
      });

      const { sos } = await service.start(UID, dto());
      await flush();

      expect(sent).toHaveLength(1);
      expect(sos.recipients.map((r) => r.contactId)).toEqual(['a']);
    });

    it('skips invalid numbers and rejects with SOS_NO_CONTACTS when none remain', async () => {
      const { service, send } = build({ contacts: [contact('a', '12345')] });

      await expect(service.start(UID, dto())).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(send).not.toHaveBeenCalled();
    });

    it('replays the same request without sending again', async () => {
      const { service, send } = build();

      const first = await service.start(UID, dto());
      await flush();
      const second = await service.start(UID, dto());
      await flush();

      expect(second.created).toBe(false);
      expect(second.sos.sosId).toBe(first.sos.sosId);
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('returns the active SOS for a new request id without new messages', async () => {
      const { service, send } = build();

      const first = await service.start(UID, dto());
      await flush();
      const second = await service.start(
        UID,
        dto({ requestId: '9b1d4c2a-1111-4222-8333-444455556666' }),
      );
      await flush();

      expect(second.created).toBe(false);
      expect(second.sos.sosId).toBe(first.sos.sosId);
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('rejects a reused request id with different input', async () => {
      const { service } = build();
      await service.start(UID, dto());
      await flush();

      const location = {
        latitude: 14.5,
        longitude: 121,
        capturedAt: new Date().toISOString(),
        accuracyMeters: 5,
      };
      await expect(service.start(UID, dto({ location }))).rejects.toBeInstanceOf(ConflictException);
    });

    it('still replays a finished request while SOS is disabled', async () => {
      const { service } = build();
      const first = await service.start(UID, dto());
      await flush();
      (
        service as unknown as { configService: { get: jest.Mock } }
      ).configService.get.mockReturnValue(false);

      const replay = await service.start(UID, dto());
      expect(replay.sos.sosId).toBe(first.sos.sosId);
    });

    it('refuses a new SOS when disabled and sends nothing', async () => {
      const { service, send } = build({ enabled: false });

      await expect(service.start(UID, dto())).rejects.toMatchObject({ status: 503 });
      expect(send).not.toHaveBeenCalled();
    });

    it('treats a stale location as unavailable and a future one as invalid', async () => {
      const { service, sent } = build();
      const stale = {
        latitude: 14.5,
        longitude: 121,
        capturedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        accuracyMeters: null,
      };

      const { sos } = await service.start(UID, dto({ location: stale }));
      await flush();
      expect(sos.location).toBeNull();
      expect(sent[0].message).toContain('Location unavailable');

      const future = { ...stale, capturedAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() };
      await expect(build().service.start(UID, dto({ location: future }))).rejects.toMatchObject({
        status: 400,
      });
    });

    it('includes a fresh location snapshot in the message', async () => {
      const { service, sent } = build();
      const location = {
        latitude: 14.5995,
        longitude: 120.9842,
        capturedAt: new Date().toISOString(),
        accuracyMeters: 8,
      };

      await service.start(UID, dto({ location }));
      await flush();

      expect(sent[0].message).toContain('https://maps.google.com/?q=14.599500,120.984200');
    });
  });

  describe('outcomes', () => {
    it('records rejected as failed and unknown as unknown, per recipient', async () => {
      let call = 0;
      const { service } = build({
        send: () => {
          call += 1;
          return Promise.resolve<SmsSendResult>(
            call === 1
              ? { outcome: 'rejected', reason: 'rate_limited', retryable: true }
              : { outcome: 'unknown', reason: 'timeout' },
          );
        },
      });

      const { sos } = await service.start(UID, dto());
      await flush();
      const after = await service.getOwned(UID, sos.sosId);

      expect(after.recipients[0].initial).toMatchObject({
        status: 'failed',
        errorCode: 'rate_limited',
      });
      expect(after.recipients[1].initial).toMatchObject({
        status: 'unknown',
        errorCode: 'timeout',
      });
      expect(after.status).toBe('active');
    });

    it('does not retry an unknown outcome', async () => {
      const { service, send } = build({
        send: () => Promise.resolve<SmsSendResult>({ outcome: 'unknown', reason: 'server_error' }),
      });

      await service.start(UID, dto());
      await flush();

      expect(send).toHaveBeenCalledTimes(2);
    });

    it('downgrades accepted to failed when the provider confirms failure', async () => {
      const { service } = build({ track: { state: 'failed', errorCode: '4' } });

      const { sos } = await service.start(UID, dto());
      await flush();
      const after = await service.getOwned(UID, sos.sosId);

      expect(after.recipients[0].initial).toMatchObject({
        status: 'failed',
        errorCode: 'delivery_failed',
      });
    });

    it('leaves accepted alone when the delivery state is not a confirmed failure', async () => {
      const { service } = build({ track: { state: 'unknown', reason: 'timeout' } });

      const { sos } = await service.start(UID, dto());
      await flush();

      expect((await service.getOwned(UID, sos.sosId)).recipients[0].initial.status).toBe(
        'accepted',
      );
    });

    it('records unknown if dispatch throws after the claim', async () => {
      const { service } = build({ send: () => Promise.reject(new Error('boom')) });

      const { sos } = await service.start(UID, dto());
      await flush();
      const after = await service.getOwned(UID, sos.sosId);

      expect(after.recipients[0].initial).toMatchObject({
        status: 'unknown',
        errorCode: 'dispatch_error',
      });
    });
  });

  describe('stop', () => {
    it('sends an end update only to recipients whose initial send was accepted or unknown', async () => {
      let call = 0;
      const { service, sent } = build({
        send: (input) => {
          call += 1;
          return Promise.resolve<SmsSendResult>(
            input.message.includes('ended')
              ? { outcome: 'accepted' }
              : call === 1
                ? { outcome: 'rejected', reason: 'invalid_input', retryable: false }
                : { outcome: 'accepted', providerMessageId: 'b2' },
          );
        },
      });
      const { sos } = await service.start(UID, dto());
      await flush();
      sent.length = 0;

      const stopped = await service.stop(UID, sos.sosId);
      await flush();

      expect(stopped.status).toBe('ended');
      expect(sent).toHaveLength(1);
      expect(sent[0].recipient).toBe('+639222222222');
      expect(sent[0].message).toContain('SOS ended by Maria Santos');
      const after = await service.getOwned(UID, sos.sosId);
      expect(after.recipients[0].ended).toBeNull();
      expect(after.recipients[1].ended?.status).toBe('accepted');
    });

    it('is idempotent: a repeated stop sends no second follow-up', async () => {
      const { service, send } = build();
      const { sos } = await service.start(UID, dto());
      await flush();
      await service.stop(UID, sos.sosId);
      await flush();
      const callsAfterFirstStop = send.mock.calls.length;

      const again = await service.stop(UID, sos.sosId);
      await flush();

      expect(again.status).toBe('ended');
      expect(send.mock.calls.length).toBe(callsAfterFirstStop);
    });

    it('cancels queued initial sends when stopped before dispatch', async () => {
      const { service, send, repo } = build();
      const queued = new Date().toISOString();
      repo.records.set('seeded', {
        sosId: 'seeded',
        uid: UID,
        requestId: REQUEST_ID,
        status: 'active',
        requesterName: 'Maria Santos',
        createdAt: queued,
        endedAt: null,
        location: null,
        recipients: [
          {
            contactId: 'a',
            name: 'A',
            phone: '+639111111111',
            initial: { status: 'queued', updatedAt: queued },
            ended: null,
          },
        ],
      });
      repo.active.set(UID, 'seeded');

      const stopped = await service.stop(UID, 'seeded');
      await flush();

      expect(stopped.recipients[0].initial.status).toBe('cancelled');
      expect(stopped.recipients[0].ended).toBeNull();
      expect(send).not.toHaveBeenCalled();
    });

    it('follows up exactly once when an in-flight send lands after stop', async () => {
      let release: (result: SmsSendResult) => void = () => undefined;
      const gate = new Promise<SmsSendResult>((resolve) => {
        release = resolve;
      });
      const { service, sent } = build({
        contacts: [contact('a', '+639111111111')],
        send: (input) =>
          input.message.includes('ended') ? Promise.resolve({ outcome: 'accepted' }) : gate,
      });
      const { sos } = await service.start(UID, dto());
      await flush(); // initial now 'sending'

      await service.stop(UID, sos.sosId);
      await flush();
      expect(sent.filter((s) => s.message.includes('ended'))).toHaveLength(0);

      release({ outcome: 'accepted', providerMessageId: 'late' });
      await flush();

      expect(sent.filter((s) => s.message.includes('ended'))).toHaveLength(1);
    });

    it('frees the user to start a new SOS after stopping', async () => {
      const { service } = build();
      const first = await service.start(UID, dto());
      await flush();
      await service.stop(UID, first.sos.sosId);
      await flush();

      expect(await service.getActive(UID)).toBeNull();
      const next = await service.start(
        UID,
        dto({ requestId: '9b1d4c2a-1111-4222-8333-444455556666' }),
      );
      expect(next.created).toBe(true);
    });

    it('treats a foreign or missing SOS as not found', async () => {
      const { service } = build();
      const { sos } = await service.start(UID, dto());

      await expect(service.stop('someone-else', sos.sosId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.getOwned(UID, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
