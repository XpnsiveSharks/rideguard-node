import { PushRegistrationFields } from '../domain/push-registration.entity';
import { PushRegistration } from '../domain/push-registration.entity';

export const PUSH_REGISTRATION_COLLECTION = 'PushRegistration';

export class NotificationMapper {
  static toPersistence(pushRegistration: PushRegistration): PushRegistrationFields {
    return {
      userId: pushRegistration.getUserId(),
      installationId: pushRegistration.getInstallationId(),
      registrationId: pushRegistration.getRegistrationId(),
      platform: pushRegistration.getPlatform(),
      deviceName: pushRegistration.getDeviceName(),
      createdAt: pushRegistration.getCreatedAt(),
      updatedAt: pushRegistration.getUpdatedAt(),
    };
  }

  static toDomain(fields: PushRegistrationFields): PushRegistration {
    return PushRegistration.create(fields);
  }
}
