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
    get: jest.fn(() => options.enabled ?? true),
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
