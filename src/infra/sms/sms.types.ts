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
//   submission acceptance, never handset delivery. `warning` carries a
//   provider-supplied code (never message text) when the provider accepted the
//   message but flagged that it is likely to fail, e.g. TextBee's
//   SMS_PERMISSION_MISSING. Callers should treat a warned send as at risk and
//   verify delivery before relying on it.
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
  | { outcome: 'accepted'; providerMessageId?: string; warning?: string }
  | { outcome: 'rejected'; reason: SmsRejectionReason; retryable: boolean; retryAfterMs?: number }
  | {
      outcome: 'unknown';
      reason:
        'timeout' | 'network_error' | 'malformed_response' | 'server_error' | 'unconfirmed_channel';
    };

// Provider-neutral delivery state of one previously accepted message.
//
// - 'pending': not yet handed to the radio (queued, processing, dispatched).
//   Not final; poll again.
// - 'sent': the handset reported it sent the SMS, but no carrier delivery
//   receipt exists. Often the best a SIM-based gateway can report.
// - 'delivered': a delivery receipt confirmed handset receipt. Final.
// - 'failed': the provider confirmed it did not go out. Final. `errorCode` is
//   the provider's code only, never its free-text message.
// - 'unknown': the status could not be determined (lookup failed or the
//   answer was not understood). Says nothing about the message itself.
export type SmsDeliveryStatus =
  | { state: 'pending' }
  | { state: 'sent' }
  | { state: 'delivered' }
  | { state: 'failed'; errorCode?: string }
  | {
      state: 'unknown';
      reason:
        | 'timeout'
        | 'network_error'
        | 'malformed_response'
        | 'server_error'
        | 'not_found'
        | 'authentication_failed'
        | 'not_configured';
    };
