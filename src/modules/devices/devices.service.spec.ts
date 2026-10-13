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

function camera(fields: Partial<DeviceFields>): Device {
  return Device.reconstitute({
    deviceId: 'CAM-111-AAA',
    deviceType: DeviceType.CAMERA,
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
