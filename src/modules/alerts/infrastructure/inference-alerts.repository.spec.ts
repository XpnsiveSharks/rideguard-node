import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import { Alert } from '../domain/alerts.entity';
import {
  INFERENCE_ALERT_COOLDOWNS_COLLECTION,
  InferenceAlertsRepository,
  InferenceThreat,
  PROCESSED_INFERENCE_EVENTS_COLLECTION,
  processedEventKey,
} from './inference-alerts.repository';

type Data = Record<string, unknown>;

// In-memory Firestore: writes buffer until the callback resolves, then apply
// together, so a failed commit leaves nothing behind. Not a concurrency test.
function fakeFirestore() {
  const docs = new Map<string, Data>();
  let autoId = 0;
  const state = { failCommit: false };

  const ref = (collection: string, id: string) => ({ id, path: `${collection}/${id}` });
  const snapshot = (path: string) => {
    const data = docs.get(path);
    return { exists: data !== undefined, get: (field: string) => data?.[field] };
  };

  const firestore = {
    collection: (name: string) => ({
      doc: (id?: string) => ref(name, id ?? `alert-${++autoId}`),
    }),
    runTransaction: async <T>(callback: (transaction: unknown) => Promise<T>): Promise<T> => {
      const writes: [string, Data, 'create' | 'set'][] = [];
      const result = await callback({
        getAll: (...refs: { path: string }[]) => Promise.resolve(refs.map((r) => snapshot(r.path))),
        create: (r: { path: string }, data: Data) => writes.push([r.path, data, 'create']),
        set: (r: { path: string }, data: Data) => writes.push([r.path, data, 'set']),
      });
      if (state.failCommit) throw new Error('commit failed');
      for (const [path, , kind] of writes) {
        if (kind === 'create' && docs.has(path)) throw new Error(`already exists: ${path}`);
      }
      for (const [path, data] of writes) docs.set(path, data);
      return result;
    },
  };

  return { firestore: firestore as unknown as Firestore, docs, state };
}

const T0 = new Date('2026-10-14T07:00:00Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

function setup() {
  const fake = fakeFirestore();
  const repository = new InferenceAlertsRepository(fake.firestore);

  const handle = (
    eventId: string,
    threats: InferenceThreat[],
    seconds: number,
    deviceId = 'CAM-111-AAA',
  ) =>
    repository.createIfEligible({
      eventId,
      threats,
      processedAt: at(seconds),
      alert: Alert.create({
        deviceId,
        message: 'Weapon detected',
        imageUrl: null,
        timeStamp: T0,
        isFalseAlarm: false,
        isSeen: false,
      }),
    });

  const alertCount = () => [...fake.docs.keys()].filter((key) => key.startsWith('alerts/')).length;
  const cooldown = (deviceId = 'CAM-111-AAA') =>
    fake.docs.get(`${INFERENCE_ALERT_COOLDOWNS_COLLECTION}/${deviceId}`);
  const processed = (eventId: string) =>
    fake.docs.get(`${PROCESSED_INFERENCE_EVENTS_COLLECTION}/${processedEventKey(eventId)}`);

  return { handle, fake, alertCount, cooldown, processed };
}

describe('InferenceAlertsRepository.createIfEligible', () => {
  it('follows the ticket timeline for one camera', async () => {
    const { handle, alertCount } = setup();

    expect((await handle('A', ['weapon'], 0)).outcome).toBe('alert_created');
    expect((await handle('A', ['weapon'], 1)).outcome).toBe('duplicate');
    expect((await handle('B', ['weapon'], 5)).outcome).toBe('suppressed_cooldown');
    expect((await handle('C', ['weapon', 'violence'], 10)).outcome).toBe('alert_created');
    expect((await handle('D', ['weapon', 'violence'], 15)).outcome).toBe('suppressed_cooldown');
    expect((await handle('E', ['weapon'], 35)).outcome).toBe('suppressed_cooldown');
    expect((await handle('F', ['weapon'], 40)).outcome).toBe('alert_created');

    expect(alertCount()).toBe(3);
  });

  it('keeps a suppressed event suppressed when replayed after the cooldown', async () => {
    const { handle, processed } = setup();
    await handle('A', ['weapon'], 0);
    await handle('B', ['weapon'], 5);

    expect((await handle('B', ['weapon'], 120)).outcome).toBe('duplicate');
    expect(processed('B')).toMatchObject({ outcome: 'suppressed_cooldown', alertId: null });
  });

  it('records the alert ID and expiry on the processed event', async () => {
    const { handle, processed } = setup();
    const result = await handle('A', ['weapon'], 0);

    expect(result.outcome).toBe('alert_created');
    const alertId = result.outcome === 'alert_created' ? result.alert.alertFields.alertId : null;
    expect(processed('A')).toMatchObject({
      eventId: 'A',
      deviceId: 'CAM-111-AAA',
      outcome: 'alert_created',
      alertId,
      processedAt: Timestamp.fromDate(at(0)),
      expiresAt: Timestamp.fromDate(new Date(T0.getTime() + 7 * 24 * 60 * 60 * 1000)),
    });
  });

  it('does not move the cooldown on suppressed events', async () => {
    const { handle, cooldown } = setup();
    await handle('A', ['weapon'], 0);
    await handle('B', ['weapon'], 5);
    await handle('C', ['weapon'], 29);

    expect(cooldown()).toEqual({
      deviceId: 'CAM-111-AAA',
      weaponLastAlertAt: Timestamp.fromDate(at(0)),
      violenceLastAlertAt: null,
    });
    expect((await handle('D', ['weapon'], 30)).outcome).toBe('alert_created');
  });

  it('resets both types after a combined alert', async () => {
    const { handle, cooldown } = setup();
    await handle('A', ['weapon'], 0);
    await handle('B', ['weapon', 'violence'], 10);

    expect(cooldown()).toMatchObject({
      weaponLastAlertAt: Timestamp.fromDate(at(10)),
      violenceLastAlertAt: Timestamp.fromDate(at(10)),
    });
    expect((await handle('C', ['violence'], 20)).outcome).toBe('suppressed_cooldown');
  });

  it("does not let one camera's cooldown suppress another", async () => {
    const { handle } = setup();
    await handle('A', ['weapon'], 0, 'CAM-111-AAA');

    expect((await handle('B', ['weapon'], 1, 'CAM-222-BBB')).outcome).toBe('alert_created');
  });

  it('skips an event ID already used by another camera', async () => {
    const { handle, alertCount } = setup();
    await handle('A', ['weapon'], 0, 'CAM-111-AAA');

    await expect(handle('A', ['weapon'], 60, 'CAM-222-BBB')).resolves.toEqual({
      outcome: 'event_conflict',
      existingDeviceId: 'CAM-111-AAA',
    });
    expect(alertCount()).toBe(1);
  });

  it('leaves no partial writes when the commit fails', async () => {
    const { handle, fake } = setup();
    fake.state.failCommit = true;

    await expect(handle('A', ['weapon'], 0)).rejects.toThrow('commit failed');
    expect(fake.docs.size).toBe(0);
  });
});
