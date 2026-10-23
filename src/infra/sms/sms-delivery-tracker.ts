import { Inject, Injectable } from '@nestjs/common';
import { SMS_STATUS_CHECKER } from './sms.constants';
import type { SmsStatusChecker } from './sms-status-checker.interface';
import type { SmsDeliveryStatus } from './sms.types';

export type TrackOptions = {
  intervalMs?: number;
  timeoutMs?: number;
};

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 60000;

// Lookups that cannot succeed by waiting: stop polling immediately.
const UNRECOVERABLE_REASONS = ['authentication_failed', 'not_configured', 'not_found'];

// Polls a status checker until a message reaches a final state or the time
// budget runs out. 'delivered' and 'failed' are final; 'sent' is not, since a
// receipt may still follow. On timeout it returns the last status seen (never
// invents a result). Callers decide what to do with a non-final answer; the
// tracker never resends.
@Injectable()
export class SmsDeliveryTracker {
  constructor(@Inject(SMS_STATUS_CHECKER) private readonly checker: SmsStatusChecker) {}

  async track(providerMessageId: string, options: TrackOptions = {}): Promise<SmsDeliveryStatus> {
    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    for (;;) {
      const status = await this.checker.getStatus(providerMessageId);
      if (status.state === 'delivered' || status.state === 'failed') {
        return status;
      }
      if (status.state === 'unknown' && UNRECOVERABLE_REASONS.includes(status.reason)) {
        return status;
      }
      if (Date.now() + intervalMs > deadline) {
        return status;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}
