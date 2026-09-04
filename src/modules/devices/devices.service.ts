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
    // This checks first if our generated device ID already exists in the database.
    const isGeneratedIdExisting = await this.deviceRepository.findDeviceById(generateDeviceId);
    // If the generated device ID does not exist
    if (!isGeneratedIdExisting) {
      // we create a new device
      const device = Device.create({
        deviceId: generateDeviceId.toString(),
        deviceType: input.deviceType,
        status: DeviceStatus.STANDBY,
      });
      // And save it to the database
      await this.deviceRepository.saveDevice(device);
    }
  }

  // *** ASSIGN DEVICE TO USER - USER ***
  async assignDeviceToUser(deviceId: string, assignedUserId: string | undefined): Promise<void> {
    DeviceId.isEmpty(deviceId);

    if (!assignedUserId) {
      throw new UnprocessableEntityException(
        'We could not verify your account. Please log in again.',
      );
    }

    const device = await this.deviceRepository.findDeviceById(deviceId);
    if (!device) {
      throw new NotFoundException(`Incorrect device ID: ${deviceId}`);
    }

    const updatedDevice = Device.AssignDeviceToUser(device, assignedUserId);
    await this.deviceRepository.updateDevice(deviceId, {
      assignedUserId: updatedDevice.getAssignedUserId(),
    });
  }

  // *** DEVICE ACTIVATION - HARDWARE ***
  async activateDevice(deviceId: string): Promise<void> {
    DeviceId.isEmpty(deviceId);
    const device = await this.deviceRepository.findDeviceById(deviceId);
    if (!device) {
      throw new NotFoundException(`Incorrect device ID: ${deviceId}`);
    }
    const updatedDevice = Device.updateDeviceStatus(device, DeviceStatus.PROVISIONED);
    await this.deviceRepository.updateDevice(deviceId, {
      status: updatedDevice.getStatus(),
    });
  }
}
