import { SmsDeliveryTracker } from './sms-delivery-tracker';
import type { SmsDeliveryStatus } from './sms.types';

function trackerWith(...statuses: SmsDeliveryStatus[]) {
  const getStatus = jest.fn();
  statuses.forEach((s) => getStatus.mockResolvedValueOnce(s));
  getStatus.mockResolvedValue(statuses[statuses.length - 1]);
  return { tracker: new SmsDeliveryTracker({ getStatus }), getStatus };
}

const fast = { intervalMs: 1, timeoutMs: 200 };

describe('SmsDeliveryTracker.track', () => {
  it('polls through pending until delivered', async () => {
    const { tracker, getStatus } = trackerWith(
      { state: 'pending' },
      { state: 'sent' },
      { state: 'delivered' },
    );
    await expect(tracker.track('b', fast)).resolves.toEqual({ state: 'delivered' });
    expect(getStatus).toHaveBeenCalledTimes(3);
    expect(getStatus).toHaveBeenCalledWith('b');
  });

  it('stops at failed and keeps the error code', async () => {
    const { tracker, getStatus } = trackerWith(
      { state: 'pending' },
      { state: 'failed', errorCode: '4' },
    );
    await expect(tracker.track('b', fast)).resolves.toEqual({ state: 'failed', errorCode: '4' });
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it('returns the last non-final status when the time budget runs out', async () => {
    const { tracker } = trackerWith({ state: 'sent' });
    await expect(tracker.track('b', { intervalMs: 20, timeoutMs: 50 })).resolves.toEqual({
      state: 'sent',
    });
  });

  it.each(['authentication_failed', 'not_configured', 'not_found'] as const)(
    'stops immediately on unrecoverable unknown/%s',
    async (reason) => {
      const { tracker, getStatus } = trackerWith({ state: 'unknown', reason });
      await expect(tracker.track('b', fast)).resolves.toEqual({ state: 'unknown', reason });
      expect(getStatus).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps polling through transient unknowns', async () => {
    const { tracker, getStatus } = trackerWith(
      { state: 'unknown', reason: 'network_error' },
      { state: 'delivered' },
    );
    await expect(tracker.track('b', fast)).resolves.toEqual({ state: 'delivered' });
    expect(getStatus).toHaveBeenCalledTimes(2);
  });
});
