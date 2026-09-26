import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Device, DeviceFields, DeviceStatus } from './domain/device.entity';
import { DeviceRepository } from './infrastructure/devices.repository';
import { DeviceId } from './domain/device-id.value-object';
import { PinoLogger } from 'nestjs-pino';
import { DEVICE_EVENTS, DEVICE_MESSAGES } from './device.constants';

@Injectable()
export class DevicesService {
  constructor(
    private readonly deviceRepository: DeviceRepository,
    private readonly logger: PinoLogger,
  ) {}

  // *** REGISTER NEW HARDWARE DEVICE - ADMIN ***
  async registerDevice(input: DeviceFields): Promise<void> {
    const device = Device.create(input);
    const generateDeviceId = device.getDeviceId();

    // This checks first if our generated device ID already exists in the database.
    const isGeneratedIdExisting = await this.deviceRepository.findDeviceById(generateDeviceId);
    // If the generated device ID does not exist
    if (!isGeneratedIdExisting) {
      // And save it to the database
      await this.deviceRepository.saveDevice(device);
      this.logger.info(
        { event: DEVICE_EVENTS.DEVICE_CREATED },
        DEVICE_MESSAGES.DEVICE_CREATED_MESSAGE(generateDeviceId),
      );
    }
  }

  // *** ASSIGN DEVICE TO USER - USER ***
  async assignDeviceToUser(deviceId: string, assignedUserId: string | undefined): Promise<void> {
    DeviceId.isEmpty(deviceId);

    const userId = assignedUserId?.trim();

    if (!userId) {
      throw new UnprocessableEntityException(
        'We could not verify your account. Please log in again.',
      );
    }

    const updatedDevice = await this.deviceRepository.assignToUser(deviceId, userId);
    await this.deviceRepository.assignToUser(deviceId, userId);

    this.logger.info(
      { event: DEVICE_EVENTS.DEVICE_ASSIGNED },
      DEVICE_MESSAGES.DEVICE_ASSIGNED_MESSAGE(updatedDevice.getDeviceId()),
    );
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

    this.logger.info(
      { event: DEVICE_EVENTS.DEVICE_ACTIVATED },
      DEVICE_MESSAGES.DEVICE_ACTIVATED_MESSAGE(deviceId),
    );
  }

  // *** GET ASSIGNED USER ID BY DEVICE ID - USER ***
  async findAssignedUserByDeviceId(deviceId: string): Promise<string> {
    DeviceId.isEmpty(deviceId);

    const assignedUserId = await this.deviceRepository.findAssignedUserIdByDeviceId(deviceId);

    if (!assignedUserId) {
      throw new NotFoundException(`This device doesn't have an assigned user`);
    }

    return assignedUserId;
  }

  // *** GET DEVICE IDS BY ASSIGNED USER ID - USER ***
  async findDeviceIdsByAssignedUser(assignedUserId: string): Promise<string[]> {
    return await this.deviceRepository.findDeviceIdsByAssignedUser(assignedUserId);
  }
}
