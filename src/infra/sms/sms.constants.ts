export const SMS_SENDER = 'SMS_SENDER';

// One GSM SMS segment. Provider-neutral: every adapter rejects oversized
// messages instead of letting a provider truncate or split a Maps link.
export const SMS_MAX_MESSAGE_LENGTH = 160;

// Loose E.164-style Philippine mobile pattern: +63 followed by a 9-prefixed
// 9-digit subscriber number (e.g. +639123456789). Provider-neutral.
export const PH_MOBILE_NUMBER_PATTERN = /^\+639\d{9}$/;

// SMS API PH send route. Confirmed by a live probe on 2026-10-22 (route
// exists, POST only) and one live send the same day.
export const SMS_API_PH_SEND_PATH = '/api/v1/send/sms';

// TextBee send route, from its API reference (reviewed 2026-10-23; not yet
// exercised against a live account). The bulk-send and status/device GET
// endpoints exist but are out of scope for this send-only adapter.
export const TEXTBEE_SEND_PATH = '/api/v1/gateway/send-sms';

export const SMS_STATUS_CHECKER = 'SMS_STATUS_CHECKER';

// TextBee batch status lookup, `{deviceId}` and `{smsBatchId}` appended by the
// adapter. Response shape observed live 2026-10-23.
export const TEXTBEE_DEVICES_PATH = '/api/v1/gateway/devices';
