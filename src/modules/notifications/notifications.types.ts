export type UnregisterPushNotificationInput = {
  userId: string | undefined;
  installationId: string;
};

// The three possible results when we try to delete a registration:
//   'deleted'   – it existed and was removed
//   'missing'   – it wasn't there to begin with
//   'not-owned' – it exists but belongs to a different user
// The repository only reports what happened. The service decides what that
// means for the HTTP response (e.g. 'not-owned' becomes 403 Forbidden).
export type DeleteRegistrationResult = 'deleted' | 'missing' | 'not-owned';
