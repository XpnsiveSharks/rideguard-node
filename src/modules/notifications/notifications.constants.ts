export const NotificationEvents = {
  PUSH_REGISTRATION_CREATED: 'push.registration.created',
} as const;

export const NotificationMessages = {
  PUSH_CREATED_MESSAGE: 'push registration created',
} as const;

// Firestore's `in` operator accepts at most 30 values per query. Larger lists of
// user IDs must be split into chunks of this size and queried separately.
export const FIRESTORE_IN_QUERY_LIMIT = 30;
