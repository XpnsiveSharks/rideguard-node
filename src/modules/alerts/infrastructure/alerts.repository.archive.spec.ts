import type { Firestore } from 'firebase-admin/firestore';
import { AlertsRepository } from './alerts.repository';

type Data = Record<string, unknown>;

// Minimal in-memory Firestore for the archive transaction: sequential reads,
// buffered writes applied after the callback resolves (so an early return
// writes nothing). Reads see writes only in a later transaction.
function fakeFirestore(seed: Record<string, Data> = {}) {
  const docs = new Map<string, Data>(Object.entries(seed));
  const snapshot = (path: string) => ({
    exists: docs.has(path),
    data: () => docs.get(path),
    get: (field: string) => docs.get(path)?.[field],
  });

  const firestore = {
    collection: (name: string) => ({
      doc: (id: string) => ({ path: `${name}/${id}` }),
    }),
    runTransaction: async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => {
      const writes: [string, Data][] = [];
      const result = await callback({
        get: (ref: { path: string }) => Promise.resolve(snapshot(ref.path)),
        update: (ref: { path: string }, data: Data) => writes.push([ref.path, data]),
      });
      for (const [path, data] of writes) docs.set(path, { ...docs.get(path), ...data });
      return result;
    },
  };

  return { firestore: firestore as unknown as Firestore, docs };
}

const NOW = new Date('2026-10-20T00:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

// A due, owned, unarchived alert with an active 24h preference.
function baseSeed(): Record<string, Data> {
  return {
    'alerts/a1': {
      deviceId: 'CAM-1',
      message: 'Weapon detected',
      isFalseAlarm: false,
      isSeen: false,
      isArchived: false,
      archivedAt: null,
      timeStamp: hoursAgo(48),
      createdAt: hoursAgo(48),
    },
    'profiles/user-1': { autoArchiveHours: 24 },
    'devices/CAM-1': { assignedUserId: 'user-1' },
  };
}

describe('AlertsRepository.archiveOneIfDue', () => {
  it('archives a due, owned, unarchived alert and stamps archivedAt', async () => {
    const { firestore, docs } = fakeFirestore(baseSeed());
    const repo = new AlertsRepository(firestore);

    await expect(repo.archiveOneIfDue('a1', 'user-1', NOW)).resolves.toBe(true);
    expect(docs.get('alerts/a1')).toMatchObject({ isArchived: true });
    expect(docs.get('alerts/a1')?.archivedAt).toBeDefined();
    expect(docs.get('alerts/a1')?.archivedAt).not.toBeNull();
  });

  it('skips when the preference changed to Never (concurrent preference change)', async () => {
    const seed = baseSeed();
    seed['profiles/user-1'] = { autoArchiveHours: null };
    const { firestore, docs } = fakeFirestore(seed);
    const repo = new AlertsRepository(firestore);

    await expect(repo.archiveOneIfDue('a1', 'user-1', NOW)).resolves.toBe(false);
    expect(docs.get('alerts/a1')).toMatchObject({ isArchived: false });
  });

  it('skips when the preference was extended so the alert is no longer due', async () => {
    const seed = baseSeed();
    // 72h window but the alert is only 48h old -> not yet due under the new period.
    seed['profiles/user-1'] = { autoArchiveHours: 72 };
    const { firestore, docs } = fakeFirestore(seed);
    const repo = new AlertsRepository(firestore);

    await expect(repo.archiveOneIfDue('a1', 'user-1', NOW)).resolves.toBe(false);
    expect(docs.get('alerts/a1')).toMatchObject({ isArchived: false });
  });

  it('skips when the device is no longer assigned to the account (ownership change)', async () => {
    const seed = baseSeed();
    seed['devices/CAM-1'] = { assignedUserId: 'user-2' };
    const { firestore, docs } = fakeFirestore(seed);
    const repo = new AlertsRepository(firestore);

    await expect(repo.archiveOneIfDue('a1', 'user-1', NOW)).resolves.toBe(false);
    expect(docs.get('alerts/a1')).toMatchObject({ isArchived: false });
  });

  it('skips when the device document is missing', async () => {
    const seed = baseSeed();
    delete seed['devices/CAM-1'];
    const { firestore } = fakeFirestore(seed);
    const repo = new AlertsRepository(firestore);

    await expect(repo.archiveOneIfDue('a1', 'user-1', NOW)).resolves.toBe(false);
  });

  it('leaves an already-archived alert untouched, preserving archivedAt (duplicate worker)', async () => {
    const seed = baseSeed();
    const original = hoursAgo(1);
    seed['alerts/a1'] = { ...seed['alerts/a1'], isArchived: true, archivedAt: original };
    const { firestore, docs } = fakeFirestore(seed);
    const repo = new AlertsRepository(firestore);

    await expect(repo.archiveOneIfDue('a1', 'user-1', NOW)).resolves.toBe(false);
    expect(docs.get('alerts/a1')?.archivedAt).toBe(original);
  });

  it('skips a false-alarm record', async () => {
    const seed = baseSeed();
    seed['alerts/a1'] = { ...seed['alerts/a1'], isFalseAlarm: true };
    const { firestore } = fakeFirestore(seed);
    const repo = new AlertsRepository(firestore);

    await expect(repo.archiveOneIfDue('a1', 'user-1', NOW)).resolves.toBe(false);
  });

  it('skips when the alert is not yet due', async () => {
    const seed = baseSeed();
    seed['alerts/a1'] = { ...seed['alerts/a1'], createdAt: hoursAgo(1), timeStamp: hoursAgo(1) };
    const { firestore, docs } = fakeFirestore(seed);
    const repo = new AlertsRepository(firestore);

    await expect(repo.archiveOneIfDue('a1', 'user-1', NOW)).resolves.toBe(false);
    expect(docs.get('alerts/a1')).toMatchObject({ isArchived: false });
  });

  it('skips a missing alert', async () => {
    const { firestore } = fakeFirestore(baseSeed());
    const repo = new AlertsRepository(firestore);

    await expect(repo.archiveOneIfDue('does-not-exist', 'user-1', NOW)).resolves.toBe(false);
  });

  it('falls back to timeStamp when createdAt is absent (legacy alert)', async () => {
    const seed = baseSeed();
    const legacy = { ...seed['alerts/a1'] };
    delete legacy.createdAt;
    seed['alerts/a1'] = legacy;
    const { firestore, docs } = fakeFirestore(seed);
    const repo = new AlertsRepository(firestore);

    await expect(repo.archiveOneIfDue('a1', 'user-1', NOW)).resolves.toBe(true);
    expect(docs.get('alerts/a1')).toMatchObject({ isArchived: true });
  });
});
