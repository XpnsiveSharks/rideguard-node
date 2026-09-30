import { PushNotificationValidationError } from './push-notification.errors';

// The raw shape a caller passes in. `create()` validates it before building the
// value object, so anything here may be untrusted or empty at this point.
export type PushNotificationFields = {
  title: string;
  body: string;
  eventType: string;
  imageUrl?: string;
  // Extra string values the frontend reads (e.g. alertId, deviceId). Keys and
  // values must both be strings because FCM only carries string data payloads.
  data?: Record<string, string>;
};

// Immutable value object describing the *content* of a push notification.
// It does not know who receives it or which FCM tokens are targeted — those
// live with push registrations. It has no Firebase or NestJS dependency.
export class PushNotification {
  // Held frozen so an instance can never be changed after it is created.
  private constructor(private readonly fields: Readonly<PushNotificationFields>) {}

  static create(fields: PushNotificationFields): PushNotification {
    const title = fields.title?.trim();
    const body = fields.body?.trim();
    const eventType = fields.eventType?.trim();

    if (!title) {
      throw new PushNotificationValidationError('Title is required');
    }

    if (!body) {
      throw new PushNotificationValidationError('Body is required');
    }

    if (!eventType) {
      throw new PushNotificationValidationError('Event type is required');
    }

    return new PushNotification(
      Object.freeze({
        title,
        body,
        eventType,
        imageUrl: PushNotification.normalizeImageUrl(fields.imageUrl),
        data: PushNotification.copyData(fields.data),
      }),
    );
  }

  getTitle(): string {
    return this.fields.title;
  }

  getBody(): string {
    return this.fields.body;
  }

  getEventType(): string {
    return this.fields.eventType;
  }

  getImageUrl(): string | undefined {
    return this.fields.imageUrl;
  }

  // Returns a fresh copy every time so callers cannot mutate our internal data.
  getData(): Record<string, string> | undefined {
    return this.fields.data ? { ...this.fields.data } : undefined;
  }

  // Value objects are compared by their contents, not by reference.
  equals(other: PushNotification): boolean {
    return (
      this.fields.title === other.fields.title &&
      this.fields.body === other.fields.body &&
      this.fields.eventType === other.fields.eventType &&
      this.fields.imageUrl === other.fields.imageUrl &&
      PushNotification.dataEquals(this.fields.data, other.fields.data)
    );
  }

  // imageUrl is optional: an empty/absent value stays undefined. When present,
  // it must parse as a real http(s) URL, otherwise we reject the notification.
  private static normalizeImageUrl(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) {
      return undefined;
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new PushNotificationValidationError('Image URL is not a valid URL');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new PushNotificationValidationError('Image URL must use http or https');
    }

    return trimmed;
  }

  // Copy the incoming object so later changes to the caller's object can't reach
  // us, then freeze the copy so our own instance stays immutable.
  //
  // The `Record<string, string>` type is only checked while coding — at runtime
  // this data may come from JSON or another untrusted source, so a value could
  // actually be a number, object, etc. FCM only carries string values, so we
  // verify each one here and reject anything that is not a string.
  private static copyData(
    data: Record<string, string> | undefined,
  ): Record<string, string> | undefined {
    if (!data) {
      return undefined;
    }

    const copy: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value !== 'string') {
        throw new PushNotificationValidationError(`Data value for "${key}" must be a string`);
      }
      copy[key] = value;
    }

    return Object.freeze(copy);
  }

  private static dataEquals(
    a: Record<string, string> | undefined,
    b: Record<string, string> | undefined,
  ): boolean {
    if (a === undefined || b === undefined) {
      return a === b;
    }

    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
      return false;
    }

    return aKeys.every((key) => a[key] === b[key]);
  }
}
