import { Injectable } from '@nestjs/common';
import { PushRegistrationsRepository } from './infrastructure/push-registrations.repository';
import { PushRegistrationFields, PushRegistration } from './domain/push-registration.entity';
import { PinoLogger } from 'nestjs-pino';
import { NotificationEvents } from './notifications.constants';
import { NotificationMessages } from './notifications.constants';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly pushRegistrationsRepository: PushRegistrationsRepository,
    private readonly logger: PinoLogger,
  ) {}

  // *** REGISTER PUSH NOTIFICATION ***
  async registerPushNotification(registration: PushRegistrationFields): Promise<void> {
    PushRegistration.isUserIdEmpty(registration.userId);

    const pushRegistration = PushRegistration.create(registration);
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
}
