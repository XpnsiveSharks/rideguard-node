export const NotificationEvents = {
  PUSH_REGISTRATION_CREATED: 'push.registration.created',
  PUSH_SEND_COMPLETED: 'push.send.completed',
} as const;

export const NotificationMessages = {
  PUSH_CREATED_MESSAGE: 'push registration created',
  PUSH_SEND_COMPLETED_MESSAGE: 'push notification send completed',
} as const;

export const FIRESTORE_IN_QUERY_LIMIT = 30;

export const FCM_MULTICAST_TOKEN_LIMIT = 500;

export const FCM_INVALID_TOKEN_ERROR_CODES: readonly string[] = [
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
];
