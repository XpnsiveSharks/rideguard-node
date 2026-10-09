import { Timestamp } from 'firebase-admin/firestore';
import { Device, DeviceFields } from '../domain/device.entity';

export const DEVICES_COLLECTION = 'devices';

// Firestore returns Timestamp objects for date fields, but the domain works in
// plain Dates. Convert on the way in and tolerate either shape.
function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return value;
  }
  if (value instanceof Timestamp) {
    return value.toDate();
  }
  return undefined;
}

export class DeviceMapper {
  static toPersistence(device: Device): DeviceFields {
    return {
      deviceId: device.getDeviceId(),
      deviceType: device.getDeviceType(),
      status: device.getStatus(),
      assignedUserId: device.getAssignedUserId(),
      deviceSecretHash: device.getDeviceSecretHash(),
      streamUrl: device.getStreamUrl(),
      lastSeenAt: device.getLastSeenAt(),
    };
  }

  static toDomain(document: DeviceFields): Device {
    return Device.reconstitute({
      deviceId: document.deviceId,
      deviceType: document.deviceType,
      status: document.status,
      assignedUserId: document.assignedUserId,
      deviceSecretHash: document.deviceSecretHash,
      streamUrl: document.streamUrl,
      lastSeenAt: toDate(document.lastSeenAt),
      createdAt: toDate(document.createdAt),
      updatedAt: toDate(document.updatedAt),
    });
  }
}
