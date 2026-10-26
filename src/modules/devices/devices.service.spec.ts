import type { PinoLogger } from 'nestjs-pino';
import {
  Device,
  DeviceFields,
  DeviceSource,
  DeviceStatus,
  DeviceType,
} from './domain/device.entity';
import type { DeviceRepository } from './infrastructure/devices.repository';
import { DevicesService } from './devices.service';
import { DisconnectDeviceTarget } from './devices.dto';
import type { PhoneCameraService } from './phone-camera.service';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

function camera(fields: Partial<DeviceFields>): Device {
  return Device.reconstitute({
    deviceId: 'CAM-111-AAA',
    deviceType: DeviceType.CAMERA,
    status: DeviceStatus.PROVISIONED,
    assignedUserId: 'user-1',
    ...fields,
  });
}

function button(fields: Partial<DeviceFields>): Device {
  return Device.reconstitute({
    deviceId: 'BUT-111-AAA',
    deviceType: DeviceType.BUTTON,
    status: DeviceStatus.PROVISIONED,
    assignedUserId: 'user-1',
    ...fields,
  });
}

describe('DevicesService.findCamerasForUser', () => {
  it('lists ESP32 and phone cameras with their source and presence', async () => {
    const now = Date.now();
    const activePhone = {
      source: DeviceSource.PHONE,
      connected: true,
      sessionExpiresAt: new Date(now + 60_000),
    };
    const repository = {
      findCamerasByAssignedUser: jest.fn().mockResolvedValue([
        camera({ deviceId: 'CAM-111-AAA', lastSeenAt: new Date(now - 1_000) }),
        camera({
          ...activePhone,
          deviceId: 'CAM-222-BBB',
          activeSessionId: 's1',
          lastSeenAt: new Date(now - 1_000),
        }),
        camera({
          ...activePhone,
          deviceId: 'CAM-333-CCC',
          activeSessionId: 's2',
          lastSeenAt: new Date(now - 120_000),
        }),
        camera({
          deviceId: 'CAM-444-DDD',
          source: DeviceSource.PHONE,
          connected: false,
          activeSessionId: null,
          lastSeenAt: new Date(now - 1_000),
        }),
      ]),
    };
    const service = new DevicesService(
      repository as unknown as DeviceRepository,
      { endSession: jest.fn() } as unknown as PhoneCameraService,
      { info: jest.fn() } as unknown as PinoLogger,
    );

    const views = await service.findCamerasForUser('user-1');

    expect(views.map((view) => [view.device_id, view.source, view.online])).toEqual([
      ['CAM-111-AAA', DeviceSource.ESP32, true],
      ['CAM-222-BBB', DeviceSource.PHONE, true],
      // Heartbeat timed out.
      ['CAM-333-CCC', DeviceSource.PHONE, false],
      // Session stopped.
      ['CAM-444-DDD', DeviceSource.PHONE, false],
    ]);
  });
});

describe('DevicesService.disconnectDevices', () => {
  it('requires an authenticated user id', async () => {
    const service = new DevicesService(
      {} as unknown as DeviceRepository,
      {} as unknown as PhoneCameraService,
      { info: jest.fn() } as unknown as PinoLogger,
    );

    await expect(service.disconnectDevices(undefined)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('disconnects all devices owned by user when target is ALL', async () => {
    const now = Date.now();
    const btn = button({ deviceId: 'BUT-111-AAA', connected: true });
    const cam = camera({
      deviceId: 'CAM-222-BBB',
      streamUrl: 'http://192.168.1.50/stream',
      lastSeenAt: new Date(now - 1_000),
      connected: true,
    });
    const phone = camera({
      deviceId: 'CAM-333-CCC',
      source: DeviceSource.PHONE,
      activeSessionId: 'session-123',
      connected: true,
      sessionExpiresAt: new Date(now + 60_000),
      lastSeenAt: new Date(now - 1_000),
    });

    const repository = {
      findDevicesByAssignedUser: jest.fn().mockResolvedValue([btn, cam, phone]),
      disconnectDevice: jest.fn().mockResolvedValue(btn),
    };
    const phoneCameraService = {
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    const service = new DevicesService(
      repository as unknown as DeviceRepository,
      phoneCameraService as unknown as PhoneCameraService,
      { info: jest.fn() } as unknown as PinoLogger,
    );

    const result = await service.disconnectDevices('user-1', DisconnectDeviceTarget.ALL);

    expect(phoneCameraService.endSession).toHaveBeenCalledWith('user-1', 'CAM-333-CCC', 'session-123');
    expect(repository.disconnectDevice).toHaveBeenCalledWith('BUT-111-AAA');
    expect(repository.disconnectDevice).toHaveBeenCalledWith('CAM-222-BBB');
    expect(result.disconnected).toEqual(['BUT-111-AAA', 'CAM-222-BBB', 'CAM-333-CCC']);
    expect(result.devices).toHaveLength(3);
    expect(result.devices.every((d) => d.status === 'disconnected')).toBe(true);
  });

  it('is idempotent when devices are already disconnected', async () => {
    const btn = button({ deviceId: 'BUT-111-AAA', connected: false });
    const cam = camera({
      deviceId: 'CAM-222-BBB',
      streamUrl: undefined,
      lastSeenAt: undefined,
      connected: false,
    });

    const repository = {
      findDevicesByAssignedUser: jest.fn().mockResolvedValue([btn, cam]),
      disconnectDevice: jest.fn().mockResolvedValue(btn),
    };
    const service = new DevicesService(
      repository as unknown as DeviceRepository,
      { endSession: jest.fn() } as unknown as PhoneCameraService,
      { info: jest.fn() } as unknown as PinoLogger,
    );

    const result = await service.disconnectDevices('user-1');

    expect(result.disconnected).toEqual([]);
    expect(result.devices).toEqual([
      { device_id: 'BUT-111-AAA', device_type: DeviceType.BUTTON, status: 'disconnected' },
      { device_id: 'CAM-222-BBB', device_type: DeviceType.CAMERA, status: 'disconnected' },
    ]);
  });

  it('filters by device=button', async () => {
    const btn = button({ deviceId: 'BUT-111-AAA', connected: true });
    const cam = camera({ deviceId: 'CAM-222-BBB', connected: true });

    const repository = {
      findDevicesByAssignedUser: jest.fn().mockResolvedValue([btn, cam]),
      disconnectDevice: jest.fn().mockResolvedValue(btn),
    };
    const service = new DevicesService(
      repository as unknown as DeviceRepository,
      { endSession: jest.fn() } as unknown as PhoneCameraService,
      { info: jest.fn() } as unknown as PinoLogger,
    );

    const result = await service.disconnectDevices('user-1', DisconnectDeviceTarget.BUTTON);

    expect(repository.disconnectDevice).toHaveBeenCalledWith('BUT-111-AAA');
    expect(repository.disconnectDevice).not.toHaveBeenCalledWith('CAM-222-BBB');
    expect(result.disconnected).toEqual(['BUT-111-AAA']);
  });

  it('filters by device=camera', async () => {
    const btn = button({ deviceId: 'BUT-111-AAA', connected: true });
    const cam = camera({
      deviceId: 'CAM-222-BBB',
      streamUrl: 'http://stream.local',
      connected: true,
    });

    const repository = {
      findDevicesByAssignedUser: jest.fn().mockResolvedValue([btn, cam]),
      disconnectDevice: jest.fn().mockResolvedValue(cam),
    };
    const service = new DevicesService(
      repository as unknown as DeviceRepository,
      { endSession: jest.fn() } as unknown as PhoneCameraService,
      { info: jest.fn() } as unknown as PinoLogger,
    );

    const result = await service.disconnectDevices('user-1', DisconnectDeviceTarget.CAMERA);

    expect(repository.disconnectDevice).toHaveBeenCalledWith('CAM-222-BBB');
    expect(repository.disconnectDevice).not.toHaveBeenCalledWith('BUT-111-AAA');
    expect(result.disconnected).toEqual(['CAM-222-BBB']);
  });

  it('validates single device ownership when device_id is provided', async () => {
    const foreignDevice = button({ deviceId: 'BUT-999-ZZZ', assignedUserId: 'other-user' });
    const repository = {
      findDeviceById: jest.fn().mockResolvedValue(foreignDevice),
    };
    const service = new DevicesService(
      repository as unknown as DeviceRepository,
      { endSession: jest.fn() } as unknown as PhoneCameraService,
      { info: jest.fn() } as unknown as PinoLogger,
    );

    await expect(
      service.disconnectDevices('user-1', DisconnectDeviceTarget.ALL, 'BUT-999-ZZZ'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException when specific device_id does not exist', async () => {
    const repository = {
      findDeviceById: jest.fn().mockResolvedValue(null),
    };
    const service = new DevicesService(
      repository as unknown as DeviceRepository,
      { endSession: jest.fn() } as unknown as PhoneCameraService,
      { info: jest.fn() } as unknown as PinoLogger,
    );

    await expect(
      service.disconnectDevices('user-1', DisconnectDeviceTarget.ALL, 'BUT-999-ZZZ'),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException if device_id does not match target type', async () => {
    const btn = button({ deviceId: 'BUT-111-AAA', assignedUserId: 'user-1' });
    const repository = {
      findDeviceById: jest.fn().mockResolvedValue(btn),
    };
    const service = new DevicesService(
      repository as unknown as DeviceRepository,
      { endSession: jest.fn() } as unknown as PhoneCameraService,
      { info: jest.fn() } as unknown as PinoLogger,
    );

    await expect(
      service.disconnectDevices('user-1', DisconnectDeviceTarget.CAMERA, 'BUT-111-AAA'),
    ).rejects.toThrow(BadRequestException);
  });
});
