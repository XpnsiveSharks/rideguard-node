import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import {
  INFERENCE_ALERT_COOLDOWNS_COLLECTION,
  InferenceAlertsRepository,
  InferenceAlertInput,
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
    return { exists: data !== undefined, get: (field: string) => data?.[field], data: () => data };
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
    labels: string[],
    seconds: number,
    overrides: Partial<InferenceAlertInput> = {},
  ) =>
    repository.createIfEligible({
      eventId,
      deviceId: 'CAM-111-AAA',
      weaponLabels: labels,
      capturedAt: at(seconds),
      imageUrl: null,
      hasFreshViolence: false,
      observationVersion: 2,
      processedAt: at(seconds),
      ...overrides,
    });

  const alertCount = () => [...fake.docs.keys()].filter((key) => key.startsWith('alerts/')).length;
  const cooldown = (deviceId = 'CAM-111-AAA') =>
    fake.docs.get(`${INFERENCE_ALERT_COOLDOWNS_COLLECTION}/${deviceId}`);
  const processed = (eventId: string) =>
    fake.docs.get(`${PROCESSED_INFERENCE_EVENTS_COLLECTION}/${processedEventKey(eventId)}`);

  return { handle, fake, alertCount, cooldown, processed };
}

describe('InferenceAlertsRepository weapon confirmation', () => {
  it('requires two matching observations and then applies cooldown', async () => {
    const { handle, alertCount } = setup();

    expect((await handle('A', ['gun'], 0)).outcome).toBe('awaiting_confirmation');
    expect((await handle('A', ['gun'], 1)).outcome).toBe('duplicate');
    expect((await handle('B', ['gun'], 2)).outcome).toBe('alert_created');
    expect((await handle('C', ['gun'], 5)).outcome).toBe('suppressed_cooldown');
    expect(alertCount()).toBe(1);
  });

  it('keeps a suppressed event suppressed when replayed after the cooldown', async () => {
    const { handle, processed } = setup();
    await handle('seed', ['gun'], 0);
    await handle('A', ['gun'], 1);
    await handle('B', ['gun'], 5);

    expect((await handle('B', ['gun'], 120)).outcome).toBe('duplicate');
    expect(processed('B')).toMatchObject({ outcome: 'suppressed_cooldown', alertId: null });
  });

  it('records the alert ID and expiry on the processed event', async () => {
    const { handle, processed } = setup();
    const result = await handle('A', [], 0, { hasFreshViolence: true });

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
    await handle('seed', ['gun'], -1);
    await handle('A', ['gun'], 0);
    await handle('B', ['gun'], 5);
    await handle('C', ['gun'], 29);

    expect(cooldown()).toMatchObject({
      deviceId: 'CAM-111-AAA',
      weaponLastAlertAt: Timestamp.fromDate(at(0)),
      violenceLastAlertAt: null,
    });
    expect((await handle('D', ['gun'], 30)).outcome).toBe('alert_created');
  });

  it('resets both types after a combined alert', async () => {
    const { handle, cooldown } = setup();
    await handle('seed', ['gun'], -1);
    await handle('A', ['gun'], 0);
    const result = await handle('B', ['gun'], 10, { hasFreshViolence: true });
    expect(result.outcome).toBe('alert_created');
    if (result.outcome === 'alert_created') {
      expect(result.alert.getMessage()).toBe('Violence and weapon detected');
    }

    expect(cooldown()).toMatchObject({
      weaponLastAlertAt: Timestamp.fromDate(at(10)),
      violenceLastAlertAt: Timestamp.fromDate(at(10)),
    });
    expect((await handle('C', [], 20, { hasFreshViolence: true })).outcome).toBe(
      'suppressed_cooldown',
    );
  });

  it("does not let one camera's cooldown suppress another", async () => {
    const { handle } = setup();
    await handle('A', ['gun'], 0);
    await handle('B', ['gun'], 1);
    expect((await handle('C', ['gun'], 1, { deviceId: 'CAM-222-BBB' })).outcome).toBe(
      'awaiting_confirmation',
    );
    expect((await handle('D', ['gun'], 2, { deviceId: 'CAM-222-BBB' })).outcome).toBe(
      'alert_created',
    );
  });

  it('skips an event ID already used by another camera', async () => {
    const { handle, alertCount } = setup();
    await handle('A', [], 0, { hasFreshViolence: true });

    await expect(handle('A', ['gun'], 60, { deviceId: 'CAM-222-BBB' })).resolves.toEqual({
      outcome: 'event_conflict',
      existingDeviceId: 'CAM-111-AAA',
    });
    expect(alertCount()).toBe(1);
  });

  it('leaves no partial writes when the commit fails', async () => {
    const { handle, fake } = setup();
    fake.state.failCommit = true;

    await expect(handle('A', [], 0, { hasFreshViolence: true })).rejects.toThrow('commit failed');
    expect(fake.docs.size).toBe(0);
  });

  it('counts a negative frame in the last three observations', async () => {
    const { handle, cooldown, alertCount } = setup();
    await handle('A', ['gun'], 0);
    await handle('B', [], 1);
    await handle('C', [], 2);
    expect((await handle('D', ['gun'], 3)).outcome).toBe('awaiting_confirmation');
    expect(alertCount()).toBe(0);
    expect(cooldown()?.weaponObservations).toHaveLength(3);
  });

  it('allows two matching hits separated by one negative', async () => {
    const { handle } = setup();
    await handle('A', ['gun'], 0);
    await handle('B', [], 1);
    expect((await handle('C', ['gun'], 2)).outcome).toBe('alert_created');
  });

  it('does not mix gun and knife evidence or count multiple boxes as frames', async () => {
    const { handle } = setup();
    expect((await handle('A', ['gun', 'gun'], 0)).outcome).toBe('awaiting_confirmation');
    expect((await handle('B', ['knife'], 1)).outcome).toBe('awaiting_confirmation');
    expect((await handle('C', [' Knife '], 2)).outcome).toBe('alert_created');
  });

  it('ignores unsupported object classes', async () => {
    const { handle, alertCount } = setup();
    await handle('A', ['person'], 0);
    expect((await handle('B', ['person'], 1)).outcome).toBe('ignored_no_threat');
    expect(alertCount()).toBe(0);
  });

  it('requires a matching positive in the current frame, even after cooldown', async () => {
    const { handle, alertCount } = setup();
    // A violence event can arrive first, so seed an existing weapon cooldown too.
    await handle('A', ['gun'], 0);
    await handle('B', ['gun'], 1);
    await handle('C', ['gun'], 29);
    await handle('D', ['gun'], 30);
    expect((await handle('E', [], 31)).outcome).toBe('ignored_no_threat');
    expect(alertCount()).toBe(1);
  });

  it('expires evidence outside the ten-second window', async () => {
    const { handle } = setup();
    await handle('A', ['gun'], 0);
    expect((await handle('B', ['gun'], 10.001)).outcome).toBe('awaiting_confirmation');
    expect((await handle('C', ['gun'], 11)).outcome).toBe('alert_created');
  });

  it('ignores stale, future, equal-time, and out-of-order observations', async () => {
    const { handle, cooldown } = setup();
    await handle('A', ['gun'], 10);
    expect((await handle('old', [], 9)).outcome).toBe('ignored_stale');
    expect((await handle('same', ['gun'], 10)).outcome).toBe('ignored_stale');
    expect((await handle('late', ['gun'], 11, { processedAt: at(42) })).outcome).toBe(
      'ignored_stale',
    );
    expect((await handle('future', ['gun'], 20, { processedAt: at(14) })).outcome).toBe(
      'ignored_stale',
    );
    expect(cooldown()?.weaponObservations).toHaveLength(1);
    expect((await handle('B', ['gun'], 11)).outcome).toBe('alert_created');
  });

  it('records negatives and duplicates without counting them twice', async () => {
    const { handle, cooldown } = setup();
    await handle('A', ['gun'], 0);
    await handle('B', [], 1);
    expect((await handle('B', [], 2)).outcome).toBe('duplicate');
    expect(cooldown()?.weaponObservations).toHaveLength(2);
    expect((await handle('C', ['gun'], 3)).outcome).toBe('alert_created');
  });

  it('preserves evidence across repository instances (restart)', async () => {
    const { handle, fake } = setup();
    await handle('A', ['gun'], 0);
    const restarted = new InferenceAlertsRepository(fake.firestore);
    const result = await restarted.createIfEligible({
      eventId: 'B',
      deviceId: 'CAM-111-AAA',
      capturedAt: at(1),
      processedAt: at(1),
      imageUrl: null,
      weaponLabels: ['gun'],
      hasFreshViolence: false,
      observationVersion: 2,
    });
    expect(result.outcome).toBe('alert_created');
  });

  it('waits for an all-observations producer before confirming weapons', async () => {
    const { handle, cooldown } = setup();
    await handle('A', ['gun'], 0, { observationVersion: undefined });
    expect((await handle('B', ['gun'], 1, { observationVersion: undefined })).outcome).toBe(
      'awaiting_observations',
    );
    expect(cooldown()).toBeUndefined();
  });

  it('keeps fresh violence immediate without an unconfirmed weapon in the message', async () => {
    const { handle } = setup();
    const result = await handle('A', ['gun'], 0, { hasFreshViolence: true });
    expect(result.outcome).toBe('alert_created');
    if (result.outcome === 'alert_created')
      expect(result.alert.getMessage()).toBe('Violence detected');
  });

  it('migrates an existing cooldown record without losing its alert times', async () => {
    const { handle, fake, cooldown } = setup();
    fake.docs.set(`${INFERENCE_ALERT_COOLDOWNS_COLLECTION}/CAM-111-AAA`, {
      deviceId: 'CAM-111-AAA',
      weaponLastAlertAt: Timestamp.fromDate(at(0)),
      violenceLastAlertAt: null,
    });
    await handle('A', ['gun'], 1);
    expect((await handle('B', ['gun'], 2)).outcome).toBe('suppressed_cooldown');
    expect(cooldown()?.weaponLastAlertAt).toEqual(Timestamp.fromDate(at(0)));
  });
});
