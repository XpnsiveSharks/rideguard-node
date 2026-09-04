import { Timestamp } from 'firebase-admin/firestore';
import { DeviceStatus, DeviceType } from '../domain/device.entity';

export const DEVICES_COLLECTION = 'devices';

export type DeviceDocument = {
  deviceId: string;
  deviceType: DeviceType;
  status: DeviceStatus;
  assignedUserId?: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
};
