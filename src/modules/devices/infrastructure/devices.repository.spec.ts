import type { Firestore } from 'firebase-admin/firestore';
import { DeviceRepository } from './devices.repository';

function fakeFirestore(docs: { id: string; data: Record<string, unknown> }[]): Firestore {
  const snapshot = {
    docs: docs.map((doc) => ({
      id: doc.id,
      data: () => doc.data,
      get: (field: string) => doc.data[field],
    })),
  };
  const query = { where: jest.fn().mockReturnThis(), get: jest.fn().mockResolvedValue(snapshot) };
  return { collection: jest.fn().mockReturnValue(query) } as unknown as Firestore;
}

describe('DeviceRepository.findCameraIdsByAssignedUser', () => {
  it('leaves phone cameras out of button pairing', async () => {
    const repository = new DeviceRepository(
      fakeFirestore([
        { id: 'CAM-111-AAA', data: {} },
        { id: 'CAM-222-BBB', data: { source: 'esp32' } },
        { id: 'CAM-333-CCC', data: { source: 'phone' } },
        { id: 'BUT-444-DDD', data: {} },
      ]),
    );

    await expect(repository.findCameraIdsByAssignedUser('user-1')).resolves.toEqual([
      'CAM-111-AAA',
      'CAM-222-BBB',
    ]);
  });
});
