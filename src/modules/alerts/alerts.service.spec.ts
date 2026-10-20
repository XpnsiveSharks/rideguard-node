import type { PinoLogger } from 'nestjs-pino';
import type { DevicesService } from '../devices/devices.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { AlertsService } from './alerts.service';
import { Alert } from './domain/alerts.entity';
import type { AlertsRepository } from './infrastructure/alerts.repository';
import type { InferenceAlertsRepository } from './infrastructure/inference-alerts.repository';

import type { SettingsService } from '../settings/settings.service';

const alert = Alert.create({
  alertId: 'alert-1',
  deviceId: 'CAM-222-BBB',
  message: 'Weapon detected',
  imageUrl: null,
  timeStamp: new Date('2026-10-14T00:00:00Z'),
  createdAt: new Date('2026-10-14T00:00:00Z'),
  isFalseAlarm: false,
  isSeen: false,
  isArchived: false,
  archivedAt: null,
});

function setup(
  sendToUsers: jest.Mock,
  findNonFalseAlarmsByDeviceId = jest.fn().mockResolvedValue({ data: [alert], nextCursor: null }),
  getAutoArchive = jest.fn().mockResolvedValue({ autoArchiveHours: 24 }),
) {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const alertsRepository = {
    findNonFalseAlarmsByDeviceId,
  } as unknown as AlertsRepository;
  const devicesService = {
    findDeviceIdsByAssignedUser: jest.fn().mockResolvedValue(['CAM-222-BBB']),
  } as unknown as DevicesService;
  const settingsService = {
    getAutoArchive,
  } as unknown as SettingsService;

  const service = new AlertsService(
    alertsRepository,
    {} as InferenceAlertsRepository,
    logger as unknown as PinoLogger,
    devicesService,
    { sendToUsers } as unknown as NotificationsService,
    settingsService,
  );
  return { service, logger, alertsRepository, settingsService };
}

describe('AlertsService.sendAlertPush', () => {
  it('logs instead of throwing when push fails, so Ably is still attempted', async () => {
    const { service, logger } = setup(jest.fn().mockRejectedValue(new Error('fcm down')));

    await expect(service.sendAlertPush(alert, 'user-1', 'event-1')).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'event-1', alertId: 'alert-1' }),
      'Failed to send alert push notification',
    );
  });

  it('logs aggregate per-device push failures', async () => {
    const result = {
      targetCount: 2,
      acceptedCount: 1,
      failedCount: 1,
      usersWithoutRegistrationsCount: 0,
    };
    const { service, logger } = setup(jest.fn().mockResolvedValue(result));

    await service.sendAlertPush(alert, 'user-1', 'event-1');

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'event-1', alertId: 'alert-1', failedCount: 1 }),
      'Some alert push notifications failed',
    );
  });
});

describe('AlertsService.getAlertsByAssignedUserId', () => {
  it('computes archiveAt based on autoArchiveHours for active alerts', async () => {
    const { service } = setup(
      jest.fn(),
      jest.fn().mockResolvedValue({ data: [alert], nextCursor: null }),
      jest.fn().mockResolvedValue({ autoArchiveHours: 24 }),
    );

    const result = await service.getAlertsByAssignedUserId('user-1', 10, undefined, 'active');
    expect(result.data).toHaveLength(1);
    const item = result.data[0];
    expect(item.getArchiveAt()).toEqual(new Date('2026-10-15T00:00:00Z'));
  });

  it('returns null archiveAt if autoArchive is null (Never)', async () => {
    const { service } = setup(
      jest.fn(),
      jest.fn().mockResolvedValue({ data: [alert], nextCursor: null }),
      jest.fn().mockResolvedValue({ autoArchiveHours: null }),
    );

    const result = await service.getAlertsByAssignedUserId('user-1', 10, undefined, 'active');
    expect(result.data[0].getArchiveAt()).toBeNull();
  });

  it('returns stored archivedAt if alert is already archived', async () => {
    const archivedAlert = Alert.create({
      ...alert.alertFields,
      isArchived: true,
      archivedAt: new Date('2026-10-15T12:00:00Z'),
    });

    const { service } = setup(
      jest.fn(),
      jest.fn().mockResolvedValue({ data: [archivedAlert], nextCursor: null }),
      jest.fn().mockResolvedValue({ autoArchiveHours: 24 }),
    );

    const result = await service.getAlertsByAssignedUserId('user-1', 10, undefined, 'archived');
    expect(result.data[0].getArchiveAt()).toEqual(new Date('2026-10-15T12:00:00Z'));
  });
});
