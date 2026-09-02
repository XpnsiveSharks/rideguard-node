import { parseEnumValue } from '@/common/helpers/enum-parser';

export class Device {
  constructor(public readonly deviceInfo: DeviceInfo) {}

  public static create(deviceInfo: DeviceInfo): Device {
    const trimmedDeviceType = parseEnumValue(deviceInfo.deviceType, DeviceType, 'device type');
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

type DeviceInfo = {
  deviceType: string;
  deviceId: string;
  status?: string;
  isProvisioned: boolean;
  provisionedAt?: Date;
  assignedUserId?: string;
  createdAt: Date;
  updatedAt: Date;
};
