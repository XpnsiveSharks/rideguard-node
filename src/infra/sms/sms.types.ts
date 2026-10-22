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
} as const;

export type SmsRejectionReason = (typeof SmsRejectionReason)[keyof typeof SmsRejectionReason];

// Provider-neutral outcome of one send attempt.
//
// - 'accepted': the provider confirmed it received the message. This is
//   submission acceptance, never handset delivery.
// - 'rejected': the provider (or local validation) definitely did not send
//   it. Safe to surface as a failure; retryable says whether the exact same
//   request may succeed later without caller changes.
// - 'unknown': a timeout or connection loss happened after submission, the
//   response could not be parsed as a known success/error shape, the
//   provider returned a server error, or a reported "success" could not be
//   confirmed as an actual SMS send. The message may or may not have reached
//   a handset. Callers must not blindly resend without their own
//   idempotency/reconciliation handling.
//
// A server error (5xx) is deliberately 'unknown', not 'rejected': an HTTP
// error alone does not prove the provider rejected the message before
// submission, so treating it as a confirmed rejection risks a false
// rejection and an unsafe blind retry.
export type SmsSendResult =
  | { outcome: 'accepted'; providerMessageId?: string }
  | { outcome: 'rejected'; reason: SmsRejectionReason; retryable: boolean; retryAfterMs?: number }
  | {
      outcome: 'unknown';
      reason:
        'timeout' | 'network_error' | 'malformed_response' | 'server_error' | 'unconfirmed_channel';
    };
