import { Injectable } from '@nestjs/common';
import { Device, DeviceInfo, DeviceStatus } from './domain/device.entity';
import { DeviceRepository } from './infrastructure/devices.repository';
import { DeviceId } from './domain/device-id.value-object';

@Injectable()
export class DevicesService {
  constructor(private readonly deviceRepository: DeviceRepository) {}

  async registerDevice(input: DeviceInfo): Promise<void> {
    const generateDeviceId = DeviceId.generate();
    const isGeneratedIdExisting = await this.deviceRepository.findDeviceById(generateDeviceId);

    if (!isGeneratedIdExisting) {
      const device = Device.create({
        deviceId: generateDeviceId.toString(),
        deviceType: input.deviceType,
        status: DeviceStatus.STANDBY,
      });

      await this.deviceRepository.saveDevice(device);
    }
  }
}
