import { NotFoundException } from '@nestjs/common';
import type { Firestore } from 'firebase-admin/firestore';
import { AlertsRepository } from './alerts.repository';

describe('AlertsRepository shared ownership check', () => {
  function build(exists = true) {
    const update = jest.fn((data: Record<string, unknown>) => Promise.resolve(data));
    const repo = new AlertsRepository({
      collection: () => ({
        doc: () => ({
          get: () =>
            Promise.resolve({
              exists,
              data: () =>
                exists
                  ? {
                      deviceId: 'camera-1',
                      message: 'Test alert',
                      timeStamp: new Date('2026-10-24T00:00:00Z'),
                    }
                  : undefined,
            }),
          update,
        }),
      }),
    } as unknown as Firestore);
    return { repo, update };
  }

  it('reads an owned alert without changing its seen or false-alarm status', async () => {
    const { repo, update } = build();
    expect((await repo.getOwned('alert-1', ['camera-1'])).alertFields.alertId).toBe('alert-1');
    expect(update).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'returns 404 for a foreign or missing alert (exists=%s)',
    async (exists) => {
      const { repo, update } = build(exists);
      await expect(repo.getOwned('alert-1', ['another-camera'])).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(repo.updateIsSeen('alert-1', ['another-camera'], true)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        repo.updateIsFalseAlarm('alert-1', ['another-camera'], true),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('keeps existing owned status updates working through the shared check', async () => {
    const { repo, update } = build();
    await repo.updateIsSeen('alert-1', ['camera-1'], true);
    await repo.updateIsFalseAlarm('alert-1', ['camera-1'], true);
    expect(update.mock.calls.map(([data]) => data)).toEqual([
      { isSeen: true },
      { isFalseAlarm: true },
    ]);
  });
});
