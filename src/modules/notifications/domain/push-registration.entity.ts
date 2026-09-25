import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { parseEnumValue } from '@/common/helpers/enum-parser';

export enum PushPlatform {
  ANDROID = 'android',
  IOS = 'ios',
  WEB = 'web',
}

export type PushRegistrationFields = {
  userId: string;
  installationId: string;
  registrationId: string;
  platform: PushPlatform;
  deviceName?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export class PushRegistration {
  private constructor(public readonly fields: PushRegistrationFields) {}

  static create(fields: PushRegistrationFields): PushRegistration {
    const installationId = fields.installationId.trim();
    const registrationId = fields.registrationId.trim();
    const userId = fields.userId.trim();

    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    if (!installationId) {
      throw new BadRequestException('Installation ID is required');
    }

    if (!registrationId) {
      throw new BadRequestException('Registration id is required');
    }

    const platform = parseEnumValue(fields.platform, PushPlatform, 'push platform');
    if (!platform) {
      throw new BadRequestException(`platform is required and must be either "android" or "ios"`);
    }

    return new PushRegistration({
      userId,
      installationId,
      registrationId,
      platform: fields.platform,
      deviceName: fields.deviceName?.trim() || undefined,
      createdAt: fields.createdAt,
      updatedAt: fields.updatedAt,
    });
  }

  static isUserIdEmpty(value: string | undefined): void {
    if (value === null || value === undefined || value.trim() === '') {
      throw new UnauthorizedException('Invalid authentication token');
    }
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

  getPlatform(): PushPlatform {
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
