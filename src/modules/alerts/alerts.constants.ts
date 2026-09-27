export const ALERT_EVENTS = {
  ALERT_CREATED: 'alert.created',
  ALERT_FAILED: 'alert.failed',
} as const;

// Fixed heading shown on the alert push notification. The alert message becomes
// the notification body.
export const ALERT_PUSH_TITLE = 'Device alert';
