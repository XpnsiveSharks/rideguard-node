import type { Firestore } from 'firebase-admin/firestore';
import { SosRepository } from './sos.repository';
import type { SosRecord } from '../sos.types';

function record(
  sosId: string,
  uid: string,
  createdAt: string,
  status: 'active' | 'ended' = 'active',
): SosRecord {
  return {
    sosId,
    uid,
    createdAt,
    status,
    requestId: 'request',
    alertId: 'alert-1',
    requesterName: 'Test user',
    endedAt: status === 'ended' ? createdAt : null,
    location: null,
    recipients: [],
  };
}

describe('SosRepository lookups', () => {
  it('selects the latest owned SOS even when it has ended and ignores a newer foreign record', async () => {
    const records = [
      record('older', 'owner', '2026-10-23T00:00:00.000Z'),
      record('latest', 'owner', '2026-10-24T00:00:00.000Z', 'ended'),
      record('foreign', 'other', '2026-10-25T00:00:00.000Z'),
    ];
    const where = jest.fn(() => ({
      get: () => Promise.resolve({ docs: records.map((r) => ({ data: () => r })) }),
    }));
    const repo = new SosRepository({ collection: () => ({ where }) } as unknown as Firestore);
    expect((await repo.findLatestByAlert('owner', 'alert-1'))?.sosId).toBe('latest');
    expect(where).toHaveBeenCalledWith('alertId', '==', 'alert-1');
    expect(await repo.findLatestByAlert('absent', 'alert-1')).toBeNull();
  });

  it('breaks equal creation-time ties deterministically by SOS ID', async () => {
    const records = ['b', 'a'].map((id) => record(id, 'owner', '2026-10-24T00:00:00.000Z'));
    const repo = new SosRepository({
      collection: () => ({
        where: () => ({
          get: () => Promise.resolve({ docs: records.map((r) => ({ data: () => r })) }),
        }),
      }),
    } as unknown as Firestore);
    expect((await repo.findLatestByAlert('owner', 'alert-1'))?.sosId).toBe('b');
  });

  it('scopes request mappings by UID and refuses a mapping to another user record', async () => {
    const doc = jest.fn((id: string) => ({
      get: () =>
        Promise.resolve({
          exists: true,
          data: () =>
            id === 'owner_request'
              ? { sosId: 'foreign', fingerprint: 'input' }
              : record('foreign', 'other', '2026-10-24T00:00:00.000Z'),
        }),
    }));
    const repo = new SosRepository({ collection: () => ({ doc }) } as unknown as Firestore);
    expect(await repo.findByRequest('owner', 'request')).toBeNull();
    expect(doc).toHaveBeenCalledWith('owner_request');
  });
});
