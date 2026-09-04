import { parseEnumValue } from '@/common/helpers/enum-parser';
import { BadRequestException } from '@nestjs/common';
import { DeviceId } from './device-id.value-object';

export class Device {
  constructor(public readonly deviceInfo: DeviceInfo) {}

  public static create(deviceInfo: DeviceInfo): Device {
    const deviceId = !deviceInfo.deviceId
      ? DeviceId.generate()
      : DeviceId.create(deviceInfo.deviceId.toString());

    const trimmedDeviceType = parseEnumValue(deviceInfo.deviceType, DeviceType, 'device type');
    if (!trimmedDeviceType) throw new BadRequestException('First name is required');

    const trimmedStatus = parseEnumValue(deviceInfo.status, DeviceStatus, 'device status');
    if (!trimmedStatus) throw new BadRequestException('First name is required');

    return new Device({
      deviceId: deviceId.toString(),
      deviceType: trimmedDeviceType,
      status: trimmedStatus,
    });
  }

  public static AssignDeviceToUser(device: Device, assignedUserId: string): Device {
    const trimmedAssignedUserId = assignedUserId?.trim();
    if (!trimmedAssignedUserId) throw new BadRequestException('Assigned user ID is required');

    return new Device({
      ...device.deviceInfo,
      assignedUserId: trimmedAssignedUserId,
    });
  }

  getDeviceId(): string {
    if (!this.deviceInfo.deviceId) {
      throw new BadRequestException('Device ID is required');
    }
    return this.deviceInfo.deviceId.toString();
  }

  getDeviceType(): DeviceType {
    return this.deviceInfo.deviceType as DeviceType;
  }

  getStatus(): DeviceStatus {
    return this.deviceInfo.status as DeviceStatus;
  }
}

export enum DeviceType {
  CAMERA = 'Camera',
  METAL_DETECTOR = 'Metal-Detector',
}

export enum DeviceStatus {
  PROVISIONED = 'Provisioned',
  STANDBY = 'Standby',
}

export type DeviceInfo = {
  deviceId?: string;
  deviceType: string;
  status?: string;
  assignedUserId?: string;
};
