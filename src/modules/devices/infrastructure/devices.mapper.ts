import { Device } from '../domain/device.entity';
export class DeviceMapper {
  static toPersistence(device: Device) {
    return {
      deviceId: device.getDeviceId(),
      deviceType: device.getDeviceType(),
      status: device.getStatus(),
    };
  }
}
