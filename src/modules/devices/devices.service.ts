import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import type {
  CameraView,
  ButtonView,
  ButtonHeartbeatResult,
  DisconnectDeviceResult,
  RegisterDeviceResult,
  RotateDeviceSecretResult,
} from './devices.types';
import { PinoLogger } from 'nestjs-pino';
import {
  CAMERA_ONLINE_WINDOW_MS,
  BUTTON_HEARTBEAT_INTERVAL_MS,
  BUTTON_ONLINE_WINDOW_MS,
  DEVICE_EVENTS,
  DEVICE_MESSAGES,
  MAX_DEVICE_ID_GENERATION_ATTEMPTS,
  PHONE_PRESENCE_TIMEOUT_MS,
} from './device.constants';
import { DisconnectDeviceTarget } from './devices.dto';
import { PhoneCameraService } from './phone-camera.service';

@Injectable()
export class DevicesService {
  constructor(
    private readonly deviceRepository: DeviceRepository,
    private readonly phoneCameraService: PhoneCameraService,
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

  // *** REPORT STREAM URL - HARDWARE ***
  // The camera calls this on connect and whenever its IP changes, so the stored
  // URL always points at the board's current address.
  async reportStreamUrl(deviceId: string, streamUrl: string): Promise<void> {
    DeviceId.isEmpty(deviceId);

    const updatedDevice = await this.deviceRepository.updateStreamUrl(deviceId, streamUrl);

    this.logger.info(
      { event: DEVICE_EVENTS.DEVICE_STREAM_URL_REPORTED },
      DEVICE_MESSAGES.DEVICE_STREAM_URL_REPORTED_MESSAGE(updatedDevice.getDeviceId()),
    );
  }

  // *** LIST CAMERAS FOR THE LOGGED-IN USER - MOBILE ***
  // Returns each camera with its current stream URL so the app can render one
  // player per camera.
  async findCamerasForUser(userId: string | undefined): Promise<CameraView[]> {
    const normalizedUserId = userId?.trim();

    if (!normalizedUserId) {
      throw new UnprocessableEntityException(
        'We could not verify your account. Please log in again.',
      );
    }

    const cameras = await this.deviceRepository.findCamerasByAssignedUser(normalizedUserId);
    const now = Date.now();

    return cameras.map((camera) => {
      const lastSeenAt = camera.getLastSeenAt();
      const online = camera.isPhone()
        ? this.isPhoneOnline(camera, now)
        : lastSeenAt
          ? now - lastSeenAt.getTime() <= CAMERA_ONLINE_WINDOW_MS
          : false;

      return {
        device_id: camera.getDeviceId(),
        source: camera.getSource(),
        stream_url: camera.getStreamUrl() ?? null,
        online,
        last_seen_at: lastSeenAt ? lastSeenAt.toISOString() : null,
      };
    });
  }

  async findButtonsForUser(userId: string | undefined): Promise<ButtonView[]> {
    const uid = userId?.trim();
    if (!uid) {
      throw new UnprocessableEntityException(
        "We could not verify your account. Please log in again.",
      );
    }
    const devices = await this.deviceRepository.findDevicesByAssignedUser(uid);
    const now = Date.now();
    return devices
      .filter(
        (device) =>
          device.getDeviceId().startsWith("BUT-") &&
          device.getDeviceType().toLowerCase() === DeviceType.BUTTON &&
          !device.isPhone(),
      )
      .sort((a, b) => a.getDeviceId().localeCompare(b.getDeviceId()))
      .map((device) => {
        const lastSeen = device.getLastSeenAt();
        const age = lastSeen
          ? now - lastSeen.getTime()
          : Number.POSITIVE_INFINITY;
        return {
          device_id: device.getDeviceId(),
          online: age >= 0 && age <= BUTTON_ONLINE_WINDOW_MS,
          last_seen_at:
            lastSeen && Number.isFinite(lastSeen.getTime())
              ? lastSeen.toISOString()
              : null,
        };
      });
  }

  async reportButtonHeartbeat(
    deviceId: string,
    authorization: string | undefined,
  ): Promise<ButtonHeartbeatResult> {
    const secret = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
    if (!secret) throw new UnauthorizedException("Invalid device credentials");
    const device = await this.verifyDeviceCredentials(deviceId, secret);
    if (
      device.getDeviceType().toLowerCase() !== DeviceType.BUTTON ||
      device.isPhone()
    ) {
      throw new ForbiddenException(
        "Heartbeats are only available to button devices",
      );
    }
    // Recheck the verified hash inside the write transaction. A secret rotated
    // after verification must not grant one last heartbeat with revoked proof.
    await this.deviceRepository.recordButtonHeartbeat(
      device.getDeviceId(),
      hashDeviceSecret(secret),
    );
    return {
      device_id: device.getDeviceId(),
      heartbeat_interval_ms: BUTTON_HEARTBEAT_INTERVAL_MS,
      online_timeout_ms: BUTTON_ONLINE_WINDOW_MS,
    };
  }

  // A phone is online while its session is active, model-api reports it
  // connected, and the last heartbeat is recent.
  private isPhoneOnline(camera: Device, now: number): boolean {
    const lastSeenAt = camera.getLastSeenAt();
    const expiresAt = camera.getSessionExpiresAt();

    return (
      camera.isConnected() &&
      camera.getActiveSessionId() !== null &&
      expiresAt !== null &&
      expiresAt.getTime() > now &&
      lastSeenAt !== undefined &&
      now - lastSeenAt.getTime() <= PHONE_PRESENCE_TIMEOUT_MS
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

  // *** GET CAMERAS PAIRED WITH A BUTTON (NON-THROWING) - SERVICE ***
  // Button and camera are linked only through their shared owner. An unknown or
  // unclaimed button has no owner and therefore no cameras. Phone cameras are
  // left out: button capture is an ESP32 feature.
  async findPairedCameraIds(buttonId: string): Promise<string[]> {
    DeviceId.isEmpty(buttonId);

    const ownerId = await this.deviceRepository.findAssignedUserIdByDeviceId(buttonId);

    if (!ownerId) {
      return [];
    }

    return await this.deviceRepository.findCameraIdsByAssignedUser(ownerId);
  }

  // *** GET OWNER ID BY DEVICE ID (NON-THROWING) ***
  async findOwnerIdByDeviceId(deviceId: string): Promise<string | null> {
    DeviceId.isEmpty(deviceId);

    return await this.deviceRepository.findAssignedUserIdByDeviceId(deviceId);
  }

  handleButtonEvent(deviceId: string, buttonEvent: string) {
    this.logger.info(`Received button event from device ${deviceId}: ${buttonEvent}`);
  }

  // *** DISCONNECT HARDWARE DEVICES - MOBILE ***
  // Idempotently disconnects button, camera, or all devices owned by the user.
  async disconnectDevices(
    userId: string | undefined,
    target: DisconnectDeviceTarget = DisconnectDeviceTarget.ALL,
    deviceId?: string,
  ): Promise<DisconnectDeviceResult> {
    const normalizedUserId = userId?.trim();

    if (!normalizedUserId) {
      throw new UnprocessableEntityException(
        'We could not verify your account. Please log in again.',
      );
    }

    let devicesToProcess: Device[] = [];

    if (deviceId?.trim()) {
      const normalizedDeviceId = DeviceId.create(deviceId).toString();
      const device = await this.deviceRepository.findDeviceById(normalizedDeviceId);

      if (!device) {
        throw new NotFoundException('Device not found');
      }

      if (device.getAssignedUserId() !== normalizedUserId) {
        throw new ForbiddenException('This device belongs to another account');
      }

      const isButton = device.getDeviceType() === DeviceType.BUTTON;
      const isCamera = device.getDeviceType() === DeviceType.CAMERA;

      if (target === DisconnectDeviceTarget.BUTTON && !isButton) {
        throw new BadRequestException(`Device ${normalizedDeviceId} is not a button`);
      }

      if (target === DisconnectDeviceTarget.CAMERA && !isCamera) {
        throw new BadRequestException(`Device ${normalizedDeviceId} is not a camera`);
      }

      devicesToProcess = [device];
    } else {
      const userDevices = await this.deviceRepository.findDevicesByAssignedUser(normalizedUserId);

      if (target === DisconnectDeviceTarget.BUTTON) {
        devicesToProcess = userDevices.filter((d) => d.getDeviceType() === DeviceType.BUTTON);
      } else if (target === DisconnectDeviceTarget.CAMERA) {
        devicesToProcess = userDevices.filter((d) => d.getDeviceType() === DeviceType.CAMERA);
      } else {
        devicesToProcess = userDevices;
      }
    }

    const now = Date.now();
    const disconnectedIds: string[] = [];

    for (const device of devicesToProcess) {
      const id = device.getDeviceId();
      let wasConnected = false;

      if (device.isPhone()) {
        wasConnected = this.isPhoneOnline(device, now) || !!device.getActiveSessionId();
        if (device.getActiveSessionId()) {
          await this.phoneCameraService.endSession(
            normalizedUserId,
            id,
            device.getActiveSessionId()!,
          );
        } else if (device.isConnected()) {
          await this.deviceRepository.disconnectDevice(id);
        }
      } else {
        const lastSeen = device.getLastSeenAt();
        const isOnline = lastSeen ? now - lastSeen.getTime() <= CAMERA_ONLINE_WINDOW_MS : false;
        wasConnected = !!device.getStreamUrl() || isOnline || device.isConnected();
        await this.deviceRepository.disconnectDevice(id);
      }

      if (wasConnected) {
        disconnectedIds.push(id);
      }

      this.logger.info(
        {
          event: DEVICE_EVENTS.DEVICE_DISCONNECTED,
          deviceId: id,
          deviceType: device.getDeviceType(),
        },
        DEVICE_MESSAGES.DEVICE_DISCONNECTED_MESSAGE(id),
      );
    }

    return {
      disconnected: disconnectedIds,
      devices: devicesToProcess.map((d) => ({
        device_id: d.getDeviceId(),
        device_type: d.getDeviceType(),
        status: 'disconnected',
      })),
    };
  }
}
