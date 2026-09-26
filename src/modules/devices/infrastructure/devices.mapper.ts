import { Device, DeviceFields } from '../domain/device.entity';

export const DEVICES_COLLECTION = 'devices';

export class DeviceMapper {
  static toPersistence(device: Device): DeviceFields {
    return {
      deviceId: device.getDeviceId(),
      deviceType: device.getDeviceType(),
      status: device.getStatus(),
      assignedUserId: device.getAssignedUserId(),
    };
  }

  static toDomain(document: DeviceFields): Device {
    return Device.reconstitute({
      deviceId: document.deviceId,
      deviceType: document.deviceType,
      status: document.status,
      assignedUserId: document.assignedUserId,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    });
  }
}
