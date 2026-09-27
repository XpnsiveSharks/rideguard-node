export const NotificationEvents = {
  PUSH_REGISTRATION_CREATED: 'push.registration.created',
  PUSH_SEND_COMPLETED: 'push.send.completed',
} as const;

export const NotificationMessages = {
  PUSH_CREATED_MESSAGE: 'push registration created',
  PUSH_SEND_COMPLETED_MESSAGE: 'push notification send completed',
} as const;

// Firestore's `in` operator accepts at most 30 values per query. Larger lists of
// user IDs must be split into chunks of this size and queried separately.
export const FIRESTORE_IN_QUERY_LIMIT = 30;

// FCM's multicast send accepts at most 500 tokens per call. Larger token lists
// must be split into batches of this size.
export const FCM_MULTICAST_TOKEN_LIMIT = 500;

// FCM error codes that mean the token is permanently invalid (the app was
// uninstalled or the token was replaced). The service uses these to remove the
// stale push registration. Other errors are transient and must not delete data.
export const FCM_INVALID_TOKEN_ERROR_CODES: readonly string[] = [
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
];
