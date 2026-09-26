import { BadRequestException, ConflictException } from '@nestjs/common';
import { DeviceId } from './device-id.value-object';

export enum DeviceType {
  CAMERA = 'camera',
  BUTTON = 'button',
}

export enum DeviceStatus {
  PROVISIONED = 'provisioned',
  STANDBY = 'standby',
}

export type DeviceFields = {
  deviceId: string;
  deviceType: DeviceType;
  status: DeviceStatus;
  assignedUserId?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export class Device {
  private constructor(private readonly fields: DeviceFields) {}

  static create(deviceType: DeviceType): Device {
    const deviceId = DeviceId.generate(deviceType);

    return new Device({
      deviceId: deviceId.toString(),
      deviceType,
      status: DeviceStatus.STANDBY,
    });
  }

  static reconstitute(fields: DeviceFields): Device {
    return new Device({
      ...fields,
    });
  }

  assignToUser(userId: string): Device {
    const normalizedUserId = userId.trim();

    if (!normalizedUserId) {
      throw new BadRequestException('User ID is required');
    }

    if (this.fields.assignedUserId && this.fields.assignedUserId !== normalizedUserId) {
      throw new ConflictException('Device is already assigned to another user');
    }

    // Allow the same request to run more than once.
    if (this.fields.assignedUserId === normalizedUserId) {
      return this;
    }

    return new Device({
      ...this.fields,
      assignedUserId: normalizedUserId,
      updatedAt: new Date(),
    });
  }

  updateStatus(status: DeviceStatus): Device {
    return new Device({
      ...this.fields,
      status,
      updatedAt: new Date(),
    });
  }

  getDeviceId(): string {
    return this.fields.deviceId;
  }

  getDeviceType(): DeviceType {
    return this.fields.deviceType;
  }

  getStatus(): DeviceStatus {
    return this.fields.status;
  }

  getAssignedUserId(): string | undefined {
    return this.fields.assignedUserId;
  }
}
