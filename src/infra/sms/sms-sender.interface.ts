import type { SmsSendInput, SmsSendResult } from './sms.types';

// Provider-neutral contract for sending one SMS to one recipient. An
// implementation owns its own authentication, payload mapping, and
// response/error parsing. Callers inject the SMS_SENDER token instead of
// importing an adapter directly, so swapping the provider binding never
// touches caller code.
export interface SmsSender {
  send(input: SmsSendInput): Promise<SmsSendResult>;
}
