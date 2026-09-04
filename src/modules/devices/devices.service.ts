import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Device, DeviceInfo, DeviceStatus } from './domain/device.entity';
import { DeviceRepository } from './infrastructure/devices.repository';
import { DeviceId } from './domain/device-id.value-object';
import { Logger } from 'nestjs-pino';
@Injectable()
export class DevicesService {
  constructor(
    private readonly deviceRepository: DeviceRepository,
    private readonly logger: Logger,
  ) {}

  // *** REGISTER NEW HARDWARE DEVICE - ADMIN ***
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

  // *** ASSIGN DEVICE TO USER - USER ***
  async assignDeviceToUser(deviceId: string, assignedUserId: string | undefined): Promise<void> {
    if (!assignedUserId) {
      throw new UnprocessableEntityException(
        'We could not verify your account. Please log in again.',
      );
    }

    this.logger.debug(`Assigning device ${deviceId} to user ${assignedUserId}`);
    DeviceId.isEmpty(deviceId);

    const device = await this.deviceRepository.findDeviceById(deviceId);
    if (!device) {
      throw new NotFoundException(`Incorrect device ID: ${deviceId}`);
    }

    const updatedDevice = Device.AssignDeviceToUser(device, assignedUserId);
    await this.deviceRepository.updateDevice(deviceId, {
      assignedUserId: updatedDevice.getAssignedUserId(),
    });
  }
}
