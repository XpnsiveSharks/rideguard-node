import type { PushNotification } from './domain/push-notification.value-object';

export type UnregisterPushNotificationInput = {
  userId: string | undefined;
  installationId: string;
};

// Input for sending one notification's content to a set of users. The service
// looks up each user's push registrations; this type does not carry FCM tokens.
export type SendPushToUsersInput = {
  userIds: readonly string[];
  notification: PushNotification;
};

// Summary of a send attempt. All counts are about what actually happened at
// send time so callers can log or report delivery outcomes.
export type SendPushResult = {
  // Unique installations (devices) we tried to send to.
  targetCount: number;
  // Sends FCM accepted.
  acceptedCount: number;
  // Sends that failed.
  failedCount: number;
  // Unique users who had no push registrations at all.
  usersWithoutRegistrationsCount: number;
};

// Result of trying to deliver to a single FCM token. The adapter reports one of
// these per token; the service counts failures and, when `isInvalidToken` is
// true, removes the matching push registration.
export type FcmSendOutcome = {
  token: string;
  success: boolean;
  // True only when FCM says the token is permanently invalid, so it is safe to
  // delete its registration. Transient failures leave this false.
  isInvalidToken: boolean;
  // FCM error code when the send failed, kept for logging. Never a token/secret.
  errorCode?: string;
};

// The three possible results when we try to delete a registration:
//   'deleted'   – it existed and was removed
//   'missing'   – it wasn't there to begin with
//   'not-owned' – it exists but belongs to a different user
// The repository only reports what happened. The service decides what that
// means for the HTTP response (e.g. 'not-owned' becomes 403 Forbidden).
export type DeleteRegistrationResult = 'deleted' | 'missing' | 'not-owned';
