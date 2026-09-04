import { parseEnumValue } from '@/common/helpers/enum-parser';
import { Timestamps } from '@/common/types/domain-types';
import { BadRequestException } from '@nestjs/common';

export class Device {
  constructor(public readonly deviceInfo: DeviceInfo) {}

  public static create(deviceInfo: DeviceInfo): Device {
    const trimmedDeviceId = deviceInfo.deviceId?.trim();
    if (!trimmedDeviceId) throw new BadRequestException('Device ID is required');

    const trimmedDeviceType = parseEnumValue(deviceInfo.deviceType, DeviceType, 'device type');
    if (!trimmedDeviceType) throw new BadRequestException('First name is required');

    const trimmedStatus = parseEnumValue(deviceInfo.status, DeviceStatus, 'device status');
    if (!trimmedStatus) throw new BadRequestException('First name is required');

    const createdAt = new Date();

    return new Device({
      deviceId: trimmedDeviceId,
      deviceType: trimmedDeviceType,
      status: trimmedStatus,
      createdAt: createdAt,
    });
  }
}

export enum DeviceType {
  CAMERA = 'Camera',
  METAL_DETECTOR = 'Metal Detector',
}

export enum DeviceStatus {
  PROVISIONED = 'Provisioned',
  STANDBY = 'Standby',
}

export type DeviceInfo = Timestamps & {
  deviceId: string;
  deviceType: string;
  status: string;
  assignedUserId?: string;
};
