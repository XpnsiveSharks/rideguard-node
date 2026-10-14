import type { PinoLogger } from 'nestjs-pino';
import type { DevicesService } from '../devices/devices.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { AlertsService } from './alerts.service';
import { Alert } from './domain/alerts.entity';
import type { AlertsRepository } from './infrastructure/alerts.repository';
import type { InferenceAlertsRepository } from './infrastructure/inference-alerts.repository';

const alert = Alert.create({
  alertId: 'alert-1',
  deviceId: 'CAM-222-BBB',
  message: 'Weapon detected',
  imageUrl: null,
  timeStamp: new Date('2026-10-14T00:00:00Z'),
  isFalseAlarm: false,
  isSeen: false,
});

function setup(sendToUsers: jest.Mock) {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const service = new AlertsService(
    {} as AlertsRepository,
    {} as InferenceAlertsRepository,
    logger as unknown as PinoLogger,
    {} as DevicesService,
    { sendToUsers } as unknown as NotificationsService,
  );
  return { service, logger };
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
