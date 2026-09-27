// Domain-specific error for invalid push-notification content. The application
// layer translates this into an HTTP response; the domain stays free of
// NestJS/HTTP concerns.
export class PushNotificationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PushNotificationValidationError';
  }
}
