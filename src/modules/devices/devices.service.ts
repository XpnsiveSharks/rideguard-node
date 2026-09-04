import { Injectable } from '@nestjs/common';
import { Device, DeviceInfo } from './domain/device.entity';
import { DeviceRepository } from './repository/device.repository';

@Injectable()
export class DevicesService {
  constructor(private readonly deviceRepository: DeviceRepository) {}

  async registerDevice(input: DeviceInfo): Promise<void> {
    const device = Device.create({
      deviceId: input.deviceId,
      deviceType: input.deviceType,
      status: input.status,
    });

    await this.deviceRepository.saveDevice(device);
  }
}
