import type { SmsDeliveryStatus } from './sms.types';

// Provider-neutral lookup of what happened to a message after SmsSender.send
// returned 'accepted'. `providerMessageId` is the id from that result.
export interface SmsStatusChecker {
  getStatus(providerMessageId: string, deviceId?: string): Promise<SmsDeliveryStatus>;
}
