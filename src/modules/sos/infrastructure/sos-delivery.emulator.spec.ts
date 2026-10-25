import { randomUUID } from 'crypto';
import { initializeApp, deleteApp, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@/config/env.validation';
import { SmsDeliveryTracker } from '@/infra/sms/sms-delivery-tracker';
import type { SmsDeliveryStatus } from '@/infra/sms/sms.types';
import { SosRepository } from './sos.repository';
import { SosDeliveryWorker } from '../sos-delivery.worker';
import { acceptedWork } from '../sos-delivery';
import type { SosRecord, SubmissionSummary } from '../sos.types';

const host = process.env.FIRESTORE_EMULATOR_HOST;
jest.setTimeout(30000);
const suite = host ? describe : describe.skip;
suite('SOS delivery persisted contention (local Firestore emulator)', () => {
  let app: App;
  let db: Firestore;
  let repo: SosRepository;
  let id: string;
  let check: jest.Mock<Promise<SmsDeliveryStatus>, [string, string]>;
  let workers: SosDeliveryWorker[];
  const config = { get: () => 1000 } as unknown as ConfigService<EnvironmentVariables, true>;
  beforeAll(() => {
    if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host!)) throw new Error('Local emulator required');
    app = initializeApp({ projectId: 'demo-rideguard-sos' }, randomUUID());
    db = getFirestore(app);
    repo = new SosRepository(db);
  });
  afterAll(async () => {
    await deleteApp(app);
  });
  beforeEach(async () => {
    id = randomUUID();
    const initial: SubmissionSummary = { status: 'accepted', updatedAt: new Date().toISOString() };
    const work = acceptedWork(
      { outcome: 'accepted', providerMessageId: 'fixture-batch', deviceId: 'original-device' },
      initial,
    )!;
    const record: SosRecord = {
      sosId: id,
      uid: 'fixture-owner',
      requestId: randomUUID(),
      requesterName: 'Fixture',
      status: 'active',
      createdAt: initial.updatedAt,
      endedAt: null,
      location: null,
      recipients: [
        {
          contactId: 'a',
          name: 'Fixture',
          phone: '+639111111111',
          initial,
          initialWork: work,
          ended: null,
        },
      ],
      deliveryDueAt: work.dueAt,
    };
    await db.collection('sos').doc(id).set(record);
    await db.collection('sos_delivery_control').doc('textbee').delete();
    check = jest.fn<Promise<SmsDeliveryStatus>, [string, string]>(async () => ({ state: 'sent' }));
    workers = [0, 1].map(
      () => new SosDeliveryWorker(repo, { check } as unknown as SmsDeliveryTracker, config),
    );
  });
  afterEach(async () => {
    await db.collection('sos').doc(id).delete();
    await db.collection('sos_delivery_control').doc('textbee').delete();
  });

  it('coalesces competing persisted refreshes and concurrent claims across instances', async () => {
    await Promise.all(
      Array.from({ length: 6 }, (_, i) => workers[i % 2].request('fixture-owner', id)),
    );
    const requested = (await repo.get(id))!.statusRefresh!.requestedAt;
    await Promise.all(workers.map((w) => w.check(id, 'a', 'initial')));
    expect(check).toHaveBeenCalledTimes(1);
    const saved = (await repo.get(id))!;
    expect(saved.statusRefresh).toMatchObject({ state: 'complete', requestedAt: requested });
    expect(saved.recipients[0].initial.delivery?.status).toBe('sent');
  });

  it('retains live leases on restart and fences a stale result after recovery', async () => {
    let resolve!: (s: SmsDeliveryStatus) => void;
    check.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const old = workers[0].check(id, 'a', 'initial');
    for (let i = 0; i < 100 && !check.mock.calls.length; i++)
      await new Promise((r) => setTimeout(r, 20));
    await workers[1].check(id, 'a', 'initial');
    expect(check).toHaveBeenCalledTimes(1);
    const deadline = (await repo.get(id))!.recipients[0].initial.delivery!.expiresAt;
    await repo.mutate(id, (record) => {
      record.recipients[0].initialWork!.leaseUntil = Date.now() - 1;
    });
    check.mockResolvedValue({ state: 'delivered' });
    await workers[1].check(id, 'a', 'initial');
    resolve({ state: 'pending' });
    await old;
    const saved = (await repo.get(id))!.recipients[0];
    expect(saved.initial.delivery).toMatchObject({ status: 'delivered', expiresAt: deadline });
    expect(saved.initialWork!.revision).toBe(2);
    expect(check).toHaveBeenLastCalledWith('fixture-batch', 'original-device');
  });

  it('enforces shared provider cooldown transactionally across two workers', async () => {
    check.mockResolvedValueOnce({ state: 'unknown', reason: 'rate_limited', retryAfterMs: 60000 });
    await workers[0].check(id, 'a', 'initial');
    await repo.mutate(id, (record) => {
      record.recipients[0].initialWork!.dueAt = Date.now();
    });
    await workers[1].check(id, 'a', 'initial');
    expect(check).toHaveBeenCalledTimes(1);
    expect((await repo.get(id))!.recipients[0].initialWork!.dueAt).toBeGreaterThan(
      Date.now() + 50000,
    );
    expect((await repo.listDeliveryDue(Date.now())).some((r) => r.sosId === id)).toBe(false);
  });
});
