import { BadRequestException, ConflictException } from '@nestjs/common';
import { DeviceId } from './device-id.value-object';

export enum DeviceType {
  CAMERA = 'camera',
  BUTTON = 'button',
}

// Where a camera's frames come from. Older documents have no source field and
// are ESP32 hardware.
export enum DeviceSource {
  ESP32 = 'esp32',
  PHONE = 'phone',
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
  source?: DeviceSource;
  // Phone cameras only. The app installation that owns this camera, the
  // session currently allowed to upload, and whether model-api reports it
  // connected.
  installationId?: string;
  activeSessionId?: string | null;
  sessionExpiresAt?: Date | null;
  connected?: boolean;
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

  // A phone camera is created already owned and provisioned. It has no hardware
  // secret; uploads use short-lived session tokens instead.
  static createPhoneCamera(userId: string, installationId: string): Device {
    return new Device({
      deviceId: DeviceId.generate(DeviceType.CAMERA),
      deviceType: DeviceType.CAMERA,
      status: DeviceStatus.PROVISIONED,
      source: DeviceSource.PHONE,
      assignedUserId: userId,
      installationId,
      connected: false,
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
    // deviceType is stored inconsistently ("Camera" vs "camera"), so compare
    // case-insensitively instead of against the exact enum value.
    const isCamera =
      typeof this.fields.deviceType === 'string' &&
      this.fields.deviceType.toLowerCase() === DeviceType.CAMERA;
    if (!isCamera) {
      throw new BadRequestException('Only cameras can report a stream URL');
    }
    if (this.isPhone()) {
      throw new BadRequestException('Phone cameras do not report a stream URL');
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

  getSource(): DeviceSource {
    return this.fields.source ?? DeviceSource.ESP32;
  }

  isPhone(): boolean {
    return this.getSource() === DeviceSource.PHONE;
  }

  getInstallationId(): string | undefined {
    return this.fields.installationId;
  }

  getActiveSessionId(): string | null {
    return this.fields.activeSessionId ?? null;
  }

  getSessionExpiresAt(): Date | null {
    return this.fields.sessionExpiresAt ?? null;
  }

  isConnected(): boolean {
    return this.fields.connected === true;
  }
}
