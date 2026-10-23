import { Injectable } from '@nestjs/common';
import { AlertsRepository } from './infrastructure/alerts.repository';
import {
  InferenceAlertInput,
  InferenceAlertOutcome,
  InferenceAlertsRepository,
} from './infrastructure/inference-alerts.repository';
import { Alert } from './domain/alerts.entity';
import { ALERT_EVENTS, ALERT_PUSH_TITLE } from './alerts.constants';
import { PinoLogger } from 'nestjs-pino';
import { DevicesService } from '../devices/devices.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PushNotification } from '../notifications/domain/push-notification.value-object';
import { SettingsService } from '../settings/settings.service';
@Injectable()
export class AlertsService {
  constructor(
    private readonly alertsRepository: AlertsRepository,
    private readonly inferenceAlertsRepository: InferenceAlertsRepository,
    private readonly logger: PinoLogger,
    private readonly diviceService: DevicesService,
    private readonly notificationsService: NotificationsService,
    private readonly settingsService: SettingsService,
  ) {}

  // *** CREATE ALERT - REALTIME INFERENCE ***
  // Saves the alert only if the event is new and not in its camera's cooldown.
  // Delivery is separate so it runs once, after the transaction commits.
  async createInferenceAlert(input: InferenceAlertInput): Promise<InferenceAlertOutcome> {
    const result = await this.inferenceAlertsRepository.createIfEligible(input);

    if (result.outcome === 'alert_created') {
      this.logger.info(
        {
          event: ALERT_EVENTS.ALERT_CREATED,
          eventId: input.eventId,
          alertId: result.alert.alertFields.alertId,
          deviceId: result.alert.alertFields.deviceId,
        },
        'Alert created',
      );
    }

    return result;
  }

  // Pushes an already-saved alert to its owner. Never throws: the alert stays
  // saved and readable through the API, so failures are only logged.
  async sendAlertPush(alert: Alert, ownerId: string, eventId: string): Promise<void> {
    const { alertId, deviceId } = alert.alertFields;

    try {
      const notification = PushNotification.create({
        title: ALERT_PUSH_TITLE,
        body: alert.getMessage(),
        eventType: ALERT_EVENTS.ALERT_CREATED,
        data: { alertId: alertId ?? '', deviceId },
      });

      const result = await this.notificationsService.sendToUsers({
        userIds: [ownerId],
        notification,
      });

      if (result.failedCount > 0) {
        this.logger.warn(
          { event: ALERT_EVENTS.ALERT_FAILED, eventId, alertId, ...result },
          'Some alert push notifications failed',
        );
      }
    } catch (error: unknown) {
      this.logger.error(
        { err: error, event: ALERT_EVENTS.ALERT_FAILED, eventId, alertId },
        'Failed to send alert push notification',
      );
    }
  }

  // *** GET ALERTS BY ASSIGNED USER ID - USER ***
  async getAlertsByAssignedUserId(
    assignedUserId: string,
    limit: number,
    cursor?: string,
    status?: 'active' | 'archived',
  ): Promise<{ data: Alert[]; nextCursor: string | null }> {
    const deviceIds = await this.diviceService.findDeviceIdsByAssignedUser(assignedUserId);

    const { data, nextCursor } = await this.alertsRepository.findNonFalseAlarmsByDeviceId(
      deviceIds,
      limit,
      cursor,
      status,
    );

    const { autoArchiveHours } = await this.settingsService.getAutoArchive(assignedUserId);

    const alertsWithArchiveAt = data.map((alert) => {
      let archiveAt: Date | null = null;
      if (alert.getIsArchived()) {
        archiveAt = alert.getArchivedAt();
      } else if (autoArchiveHours !== null) {
        archiveAt = new Date(alert.getCreatedAt().getTime() + autoArchiveHours * 3600 * 1000);
      }

      return Alert.create({
        ...alert.alertFields,
        archiveAt,
      });
    });

    return {
      data: alertsWithArchiveAt,
      nextCursor,
    };
  }

  // Read with the same assigned-device ownership check as status updates.
  async getOwned(alertId: string, assignedUserId: string): Promise<Alert> {
    const deviceIds = await this.diviceService.findDeviceIdsByAssignedUser(assignedUserId);
    return this.alertsRepository.getOwned(alertId, deviceIds);
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
