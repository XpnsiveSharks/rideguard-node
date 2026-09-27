import { Injectable } from '@nestjs/common';
import { AlertsRepository } from './infrastructure/alerts.repository';
import { Alert, AlertFields } from './domain/alerts.entity';
import { ALERT_EVENTS, ALERT_PUSH_TITLE } from './alerts.constants';
import { PinoLogger } from 'nestjs-pino';
import { DevicesService } from '../devices/devices.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PushNotification } from '../notifications/domain/push-notification.value-object';
@Injectable()
export class AlertsService {
  constructor(
    private readonly alertsRepository: AlertsRepository,
    private readonly logger: PinoLogger,
    private readonly diviceService: DevicesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // *** CREATE ALERT - REALTIME INFERENCE ***
  async createAlert(alert: AlertFields): Promise<Alert> {
    const newAlert = Alert.create(alert);
    const savedAlertId = await this.alertsRepository.save(newAlert);

    // Rebuild the alert with the real Firestore document ID. Notification and
    // realtime payloads read alertId from here, and it must be the stored ID —
    // never the optional incoming ID, which may differ from what Firestore saved.
    const savedAlert = Alert.create({ ...newAlert.alertFields, alertId: savedAlertId });

    this.logger.info(
      { event: ALERT_EVENTS.ALERT_CREATED },
      `Alert created: ${JSON.stringify(savedAlert)}`,
    );

    // Push delivery
    await this.sendAlertPush(savedAlert, savedAlertId);

    return savedAlert;
  }

  // Notifies the device owner about a new alert. Failures here never affect alert
  // creation: the alert is already saved, so we log and move on.
  private async sendAlertPush(alert: Alert, alertId: string): Promise<void> {
    try {
      const deviceId = alert.alertFields.deviceId;
      const ownerId = await this.diviceService.findOwnerIdByDeviceId(deviceId);

      // Unclaimed device: nobody to notify.
      if (!ownerId) {
        return;
      }

      const notification = PushNotification.create({
        title: ALERT_PUSH_TITLE,
        body: alert.getMessage(),
        eventType: ALERT_EVENTS.ALERT_CREATED,
        data: { alertId, deviceId },
      });

      await this.notificationsService.sendToUsers({ userIds: [ownerId], notification });
    } catch (error: unknown) {
      this.logger.error(
        { err: error, event: ALERT_EVENTS.ALERT_FAILED, alertId },
        'Failed to send alert push notification',
      );
    }
  }

  // *** GET ALERTS BY ASSIGNED USER ID - USER ***
  async getAlertsByAssignedUserId(
    assignedUserId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ data: Alert[]; nextCursor: string | null }> {
    const deviceIds = await this.diviceService.findDeviceIdsByAssignedUser(assignedUserId);

    return await this.alertsRepository.findNonFalseAlarmsByDeviceId(deviceIds, limit, cursor);
  }

  // *** UPDATE ALERT SEEN STATUS - USER ***
  async updateAlertSeen(alertId: string, assignedUserId: string, isSeen: boolean): Promise<Alert> {
    const deviceIds = await this.diviceService.findDeviceIdsByAssignedUser(assignedUserId);

    return await this.alertsRepository.updateIsSeen(alertId, deviceIds, isSeen);
  }

  // *** UPDATE ALERT FALSE ALARM STATUS - USER ***
  async updateAlertFalseAlarm(
    alertId: string,
    assignedUserId: string,
    isFalseAlarm: boolean,
  ): Promise<Alert> {
    const deviceIds = await this.diviceService.findDeviceIdsByAssignedUser(assignedUserId);

    return await this.alertsRepository.updateIsFalseAlarm(alertId, deviceIds, isFalseAlarm);
  }
}
