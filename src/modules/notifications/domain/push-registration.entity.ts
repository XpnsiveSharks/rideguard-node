import { parseEnumValue } from '@/common/helpers/enum-parser';
import { PushRegistrationValidationError } from './push-registration.errors';

export enum PushPlatform {
  ANDROID = 'android',
  IOS = 'ios',
  WEB = 'web',
}

export type PushRegistrationFields = {
  userId: string;
  installationId: string;
  registrationId: string;
  platform: string;
  deviceName?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export class PushRegistration {
  private constructor(public readonly fields: PushRegistrationFields) {}

  static create(fields: PushRegistrationFields): PushRegistration {
    const installationId = fields.installationId.trim();
    const registrationId = fields.registrationId.trim();
    const parsedPlatformField = parseEnumValue(fields.platform, PushPlatform, 'push platform');
    const userId = fields.userId.trim();

    if (!userId) {
      throw new PushRegistrationValidationError('User ID is required');
    }

    if (!installationId) {
      throw new PushRegistrationValidationError('Installation ID is required');
    }

    if (!registrationId) {
      throw new PushRegistrationValidationError('Registration id is required');
    }

    return new PushRegistration({
      userId,
      installationId,
      registrationId,
      platform: parsedPlatformField,
      deviceName: fields.deviceName?.trim() || undefined,
      createdAt: fields.createdAt,
      updatedAt: fields.updatedAt,
    });
  }

  getUserId(): string {
    return this.fields.userId;
  }

  getInstallationId(): string {
    return this.fields.installationId;
  }

  getRegistrationId(): string {
    return this.fields.registrationId;
  }

  getPlatform(): string {
    return this.fields.platform;
  }

  getDeviceName(): string | undefined {
    return this.fields.deviceName;
  }

  getCreatedAt(): Date {
    return new Date();
  }

  getUpdatedAt(): Date {
    return new Date();
  }
}
