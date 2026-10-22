export const SMS_SENDER = 'SMS_SENDER';

// SMS API PH's documentation site (inspected 2026-10-19, not yet reverified
// against a real account) advertises a 160-character limit per message.
// Reject oversized messages instead of silently truncating a Maps link.
export const SMS_API_PH_MAX_MESSAGE_LENGTH = 160;

// Loose E.164-style Philippine mobile pattern: +63 followed by a 9-prefixed
// 9-digit subscriber number, matching the provider's documented example
// (+639123456789).
export const PH_MOBILE_NUMBER_PATTERN = /^\+639\d{9}$/;

// Confirmed by a live probe on 2026-10-22 (missing/malformed credentials
// against https://smsapiph.onrender.com): the route exists and only accepts
// POST. The send-success response shape is still unverified.
export const SMS_API_PH_SEND_PATH = '/api/v1/send/sms';
