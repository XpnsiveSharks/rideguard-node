import { Device } from '../domain/device.entity';
import { DeviceDocument } from './devices.document';
export class DeviceMapper {
  static toPersistence(device: Device) {
    return {
      deviceId: device.getDeviceId(),
      deviceType: device.getDeviceType(),
      status: device.getStatus(),
    };
  }

  static toDomain(document: DeviceDocument): Device {
    return Device.create({
      deviceId: document.deviceId,
      deviceType: document.deviceType,
      status: document.status,
      assignedUserId: document.assignedUserId,
    });
  }
}
