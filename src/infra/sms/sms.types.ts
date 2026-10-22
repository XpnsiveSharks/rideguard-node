// Input for sending one message to one recipient. Message composition and
// recipient selection stay in the calling application service; the adapter
// never chooses either.
export type SmsSendInput = {
  recipient: string;
  message: string;
};

export const SmsRejectionReason = {
  // Failed local validation before any network call was made.
  INVALID_RECIPIENT: 'invalid_recipient',
  MESSAGE_TOO_LONG: 'message_too_long',
  // The provider definitely rejected the request before sending anything.
  AUTHENTICATION_FAILED: 'authentication_failed',
  INVALID_INPUT: 'invalid_input',
  RATE_LIMITED: 'rate_limited',
  PROVIDER_ERROR: 'provider_error',
} as const;

export type SmsRejectionReason = (typeof SmsRejectionReason)[keyof typeof SmsRejectionReason];

// Provider-neutral outcome of one send attempt.
//
// - 'accepted': the provider confirmed it received the message. This is
//   submission acceptance, never handset delivery.
// - 'rejected': the provider (or local validation) definitely did not send
//   it. Safe to surface as a failure; retryable says whether the exact same
//   request may succeed later without caller changes.
// - 'unknown': a timeout or connection loss happened after submission, or the
//   response could not be parsed as a known success/error shape. The message
//   may or may not have reached the provider. Callers must not blindly
//   resend without their own idempotency/reconciliation handling.
export type SmsSendResult =
  | { outcome: 'accepted'; providerMessageId?: string }
  | { outcome: 'rejected'; reason: SmsRejectionReason; retryable: boolean; retryAfterMs?: number }
  | { outcome: 'unknown'; reason: 'timeout' | 'network_error' | 'malformed_response' };
