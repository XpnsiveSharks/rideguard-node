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

// Count distinct processed frames, including negatives, per camera and label.
export const WEAPON_CONFIRMATION_FRAME_COUNT = 3;
export const WEAPON_CONFIRMATION_REQUIRED_HITS = 2;
export const WEAPON_CONFIRMATION_WINDOW_SECONDS = 10;
// Allows time for CPU inference and image upload, but rejects replayed evidence.
export const INFERENCE_OBSERVATION_MAX_AGE_SECONDS = 30;
export const INFERENCE_CLOCK_SKEW_SECONDS = 5;
