import { Device, DeviceFields } from '../domain/device.entity';

export const DEVICES_COLLECTION = 'devices';

export class DeviceMapper {
  static toPersistence(device: Device): DeviceFields {
    return {
      deviceId: device.getDeviceId(),
      deviceType: device.getDeviceType(),
      status: device.getStatus(),
      assignedUserId: device.getAssignedUserId(),
      deviceSecretHash: device.getDeviceSecretHash(),
    };
  }

  static toDomain(document: DeviceFields): Device {
    return Device.reconstitute({
      deviceId: document.deviceId,
      deviceType: document.deviceType,
      status: document.status,
      assignedUserId: document.assignedUserId,
      deviceSecretHash: document.deviceSecretHash,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    });
  }
}
