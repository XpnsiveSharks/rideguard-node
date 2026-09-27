import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PushRegistrationsRepository } from './infrastructure/push-registrations.repository';
import { PushRegistrationFields, PushRegistration } from './domain/push-registration.entity';
import { PushRegistrationValidationError } from './domain/push-registration.errors';
import { PinoLogger } from 'nestjs-pino';
import { NotificationEvents } from './notifications.constants';
import { NotificationMessages } from './notifications.constants';
import type { UnregisterPushNotificationInput } from './notifications.types';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly pushRegistrationsRepository: PushRegistrationsRepository,
    private readonly logger: PinoLogger,
  ) {}

  // *** REGISTER PUSH NOTIFICATION ***
  async registerPushNotification(registration: PushRegistrationFields): Promise<void> {
    this.assertAuthenticated(registration.userId);

    let pushRegistration: PushRegistration;
    try {
      pushRegistration = PushRegistration.create(registration);
    } catch (error) {
      // The domain layer throws its own error type so it stays free of NestJS.
      // At this HTTP boundary we turn that into a 400 Bad Request. Any other
      // error is unexpected, so we let it bubble up unchanged.
      if (error instanceof PushRegistrationValidationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    await this.pushRegistrationsRepository.save(pushRegistration);

    this.logger.info(
      {
        event: NotificationEvents.PUSH_REGISTRATION_CREATED,
        installationId: registration.installationId,
        userId: registration.userId,
      },
      NotificationMessages.PUSH_CREATED_MESSAGE,
    );
  }

  // *** UNREGISTER PUSH NOTIFICATION ***
  async unregisterPushNotification(input: UnregisterPushNotificationInput): Promise<void> {
    this.assertAuthenticated(input.userId);
    const userId = input.userId;

    const installationId = input.installationId?.trim();
    if (!installationId || installationId.includes('/')) {
      throw new BadRequestException('Invalid installation ID');
    }

    const result = await this.pushRegistrationsRepository.deleteOwnedRegistration(
      installationId,
      userId,
    );

    // 'deleted' and 'missing' both count as success: the caller just wants this
    // registration gone, and deleting something twice should be safe (idempotent).
    // Only 'not-owned' is an error, since the registration belongs to someone else.
    if (result === 'not-owned') {
      throw new ForbiddenException('You cannot remove this push registration');
    }
  }

  // Rejects the request if there is no signed-in user. The `asserts userId is
  // string` return type tells TypeScript that once this passes, `userId` is
  // definitely a string, so the rest of the method needs no extra null checks.
  private assertAuthenticated(userId: string | undefined): asserts userId is string {
    if (!userId || userId.trim() === '') {
      throw new UnauthorizedException('Invalid authentication token');
    }
  }
}
