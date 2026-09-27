// Domain-specific error for invalid push-registration state. The application
// layer translates this into an HTTP response; the domain stays free of
// NestJS/HTTP concerns.
export class PushRegistrationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PushRegistrationValidationError';
  }
}
