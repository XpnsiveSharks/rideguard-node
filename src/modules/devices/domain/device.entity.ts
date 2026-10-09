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
  deviceSecretHash?: string;
  streamUrl?: string;
  lastSeenAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
};

export class Device {
  private constructor(private readonly fields: DeviceFields) {}

  static create(deviceType: DeviceType, deviceSecretHash: string): Device {
    const deviceId = DeviceId.generate(deviceType);

    return new Device({
      deviceId: deviceId.toString(),
      deviceType,
      status: DeviceStatus.STANDBY,
      deviceSecretHash,
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

  activate(): Device {
    if (this.fields.status === DeviceStatus.PROVISIONED) {
      return this;
    }

    return new Device({
      ...this.fields,
      status: DeviceStatus.PROVISIONED,
      updatedAt: new Date(),
    });
  }

  // The camera reports the URL its MJPEG stream is reachable at. The URL
  // changes with the board's IP, so each report overwrites the last one and
  // refreshes lastSeenAt, which the online check reads.
  reportStreamUrl(streamUrl: string): Device {
    if (this.fields.deviceType !== DeviceType.CAMERA) {
      throw new BadRequestException('Only cameras can report a stream URL');
    }

    const normalizedUrl = streamUrl?.trim();
    if (!normalizedUrl) {
      throw new BadRequestException('Stream URL is required');
    }

    return new Device({
      ...this.fields,
      streamUrl: normalizedUrl,
      lastSeenAt: new Date(),
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

  getDeviceSecretHash(): string | undefined {
    return this.fields.deviceSecretHash;
  }

  getStreamUrl(): string | undefined {
    return this.fields.streamUrl;
  }

  getLastSeenAt(): Date | undefined {
    return this.fields.lastSeenAt;
  }
}
