import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Device, DeviceType } from './domain/device.entity';
import { DeviceRepository } from './infrastructure/devices.repository';
import { DeviceId } from './domain/device-id.value-object';
import { generateDeviceSecret, hashDeviceSecret } from './infrastructure/device-secret';
import type { RegisterDeviceResult, RotateDeviceSecretResult } from './devices.types';
import { PinoLogger } from 'nestjs-pino';
import {
  DEVICE_EVENTS,
  DEVICE_MESSAGES,
  MAX_DEVICE_ID_GENERATION_ATTEMPTS,
} from './device.constants';

@Injectable()
export class DevicesService {
  constructor(
    private readonly deviceRepository: DeviceRepository,
    private readonly logger: PinoLogger,
  ) {}

  async verifyDeviceCredentials(deviceId: string, secret: string): Promise<Device> {
    if (!secret?.trim()) {
      throw new UnauthorizedException('Invalid device credentials');
    }

    let normalizedDeviceId: string;
    try {
      normalizedDeviceId = DeviceId.create(deviceId).toString();
    } catch {
      throw new UnauthorizedException('Invalid device credentials');
    }

    // Keep database failures separate from authentication failures.
    const device = await this.deviceRepository.findDeviceById(normalizedDeviceId);
    const storedHash = device?.getDeviceSecretHash();
    if (!device || typeof storedHash !== 'string' || !/^[a-f0-9]{64}$/.test(storedHash)) {
      throw new UnauthorizedException('Invalid device credentials');
    }

    const suppliedHash = Buffer.from(hashDeviceSecret(secret), 'hex');
    if (!timingSafeEqual(suppliedHash, Buffer.from(storedHash, 'hex'))) {
      throw new UnauthorizedException('Invalid device credentials');
    }

    return device;
  }

  // *** REGISTER NEW HARDWARE DEVICE - ADMIN ***
  async registerDevice(deviceType: DeviceType): Promise<RegisterDeviceResult> {
    const deviceSecret = generateDeviceSecret();
    const deviceSecretHash = hashDeviceSecret(deviceSecret);

    // Generated IDs can collide, so regenerate until we find a free one.
    for (let attempt = 1; attempt <= MAX_DEVICE_ID_GENERATION_ATTEMPTS; attempt++) {
      const device = Device.create(deviceType, deviceSecretHash);
      const deviceId = device.getDeviceId();

      const existingDevice = await this.deviceRepository.findDeviceById(deviceId);
      if (existingDevice) {
        continue;
      }

      await this.deviceRepository.saveDevice(device);

      this.logger.info(
        { event: DEVICE_EVENTS.DEVICE_CREATED },
        DEVICE_MESSAGES.DEVICE_CREATED_MESSAGE(deviceId),
      );

      return { deviceId, deviceSecret };
    }

    throw new ConflictException(
      'Could not generate a unique device ID. Please try registering again.',
    );
  }

  // *** ROTATE DEVICE SECRET - ADMIN / MANUFACTURING ***
  async rotateDeviceSecret(deviceId: string): Promise<RotateDeviceSecretResult> {
    DeviceId.isEmpty(deviceId);

    // Only the hash is persisted; the raw secret stays in memory and is returned
    // once after the update succeeds. It is never stored or logged.
    const deviceSecret = generateDeviceSecret();
    const deviceSecretHash = hashDeviceSecret(deviceSecret);

    // Throws NotFoundException when the device does not exist; never creates one.
    await this.deviceRepository.rotateSecret(deviceId, deviceSecretHash);

    this.logger.info(
      { event: DEVICE_EVENTS.DEVICE_SECRET_ROTATED },
      DEVICE_MESSAGES.DEVICE_SECRET_ROTATED_MESSAGE(deviceId),
    );

    return { deviceId, deviceSecret };
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

    this.logger.info(`Assigning device ${deviceId} to user ${userId}`);
    const updatedDevice = await this.deviceRepository.assignToUser(deviceId, userId);

    this.logger.info(
      { event: DEVICE_EVENTS.DEVICE_ASSIGNED },
      DEVICE_MESSAGES.DEVICE_ASSIGNED_MESSAGE(updatedDevice.getDeviceId()),
    );
  }

  // *** DEVICE ACTIVATION - HARDWARE ***
  async activateDevice(deviceId: string): Promise<void> {
    DeviceId.isEmpty(deviceId);

    const activatedDevice = await this.deviceRepository.activate(deviceId);

    this.logger.info(
      { event: DEVICE_EVENTS.DEVICE_ACTIVATED },
      DEVICE_MESSAGES.DEVICE_ACTIVATED_MESSAGE(activatedDevice.getDeviceId()),
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

  // *** GET OWNER ID BY DEVICE ID (NON-THROWING) ***
  async findOwnerIdByDeviceId(deviceId: string): Promise<string | null> {
    DeviceId.isEmpty(deviceId);

    return await this.deviceRepository.findAssignedUserIdByDeviceId(deviceId);
  }

  handleButtonEvent(deviceId: string, buttonEvent: string) {
    this.logger.info(`Received button event from device ${deviceId}: ${buttonEvent}`);
  }
}
