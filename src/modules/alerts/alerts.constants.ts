export const ALERT_EVENTS = {
  ALERT_CREATED: 'alert.created',
  ALERT_FAILED: 'alert.failed',
} as const;

// Fixed heading shown on the alert push notification. The alert message becomes
// the notification body.
export const ALERT_PUSH_TITLE = 'Device alert';

// Processed inference events are kept this long for duplicate protection. Set
// a Firestore TTL policy on processed_inference_events.expiresAt to delete
// them; changing this only affects new records.
export const INFERENCE_EVENT_RETENTION_DAYS = 7;

// After an alert, the same threat type from the same camera is suppressed for
// this long. A threat type not in the last alert is never suppressed by it.
export const INFERENCE_ALERT_COOLDOWN_SECONDS = 30;
