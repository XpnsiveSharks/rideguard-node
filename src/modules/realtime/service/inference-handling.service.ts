import { Injectable } from '@nestjs/common';
import { InferenceResult } from '../types/inference-result';
import { Alert } from '@/modules/alerts/domain/alerts.entity';
import { DeviceId } from '@/modules/devices/domain/device-id.value-object';
import { AlertsService } from '@/modules/alerts/alerts.service';
import { InferenceThreat } from '@/modules/alerts/infrastructure/inference-alerts.repository';
import { RealtimePublisherService } from './realtime-publishing.service';
import { REALTIME_CHANNELS } from '../realtime.constants';
import { DevicesService } from '@/modules/devices/devices.service';
import { PinoLogger } from 'nestjs-pino';
@Injectable()
export class InferenceHandlingService {
  constructor(
    private readonly alertsService: AlertsService,
    private readonly realtimePublisherService: RealtimePublisherService,
    private readonly deviceService: DevicesService,
    private readonly logger: PinoLogger,
  ) {}

  async handleResult(result: InferenceResult): Promise<void> {
    const prepared = this.prepareInferenceResult(result);

    // model-api publishes threats only, but a result with no threat must never
    // become an alert. Continuous phone capture would otherwise flood users.
    if (!prepared) {
      return;
    }

    const eventId = result.event_id;
    const outcome = await this.alertsService.createInferenceAlert({
      eventId,
      alert: prepared.alert,
      threats: prepared.threats,
      // Captured once, outside the transaction, so a retry reuses it.
      processedAt: new Date(),
    });
    const deviceId = prepared.alert.alertFields.deviceId;

    if (outcome.outcome === 'event_conflict') {
      this.logger.warn(
        { eventId, deviceId, existingDeviceId: outcome.existingDeviceId },
        'Inference event ID already used by another camera; skipped',
      );
      return;
    }
    if (outcome.outcome !== 'alert_created') {
      this.logger.info({ eventId, deviceId, outcome: outcome.outcome }, 'Inference alert skipped');
      return;
    }

    await this.deliver(outcome.alert, eventId);
  }

  // One attempt each for push and Ably, after the alert is saved. A failure in
  // one never stops the other, and the alert stays readable through the API.
  private async deliver(alert: Alert, eventId: string): Promise<void> {
    const { alertId, deviceId } = alert.alertFields;
    const ownerId = await this.deviceService.findOwnerIdByDeviceId(deviceId);

    if (!ownerId) {
      this.logger.warn(
        { eventId, alertId, deviceId },
        'Alert saved but not delivered: camera has no assigned user',
      );
      return;
    }

    await this.alertsService.sendAlertPush(alert, ownerId, eventId);

    try {
      await this.realtimePublisherService.publishAlert(
        REALTIME_CHANNELS.alerts(ownerId, deviceId),
        alert,
      );
    } catch (error: unknown) {
      this.logger.error({ err: error, eventId, alertId }, 'Realtime alert not delivered');
    }
  }

  private prepareInferenceResult(
    result: InferenceResult,
  ): { alert: Alert; threats: InferenceThreat[] } | null {
    const { device_id, captured_at, detections, violence, image } = result;

    const imageUrl = image?.url ?? null;
    const deviceId = DeviceId.create(device_id).toString();
    const capturedAt = new Date(captured_at);
    const hasWeapon = detections.objects.length > 0;
    const hasFreshViolence = violence?.label === 'violent' && violence?.inference_ran === true;
    const alertMessage = this.buildAlertMessage(hasWeapon, hasFreshViolence);
    this.logger.info(detections.objects, 'Detected objects');

    if (!alertMessage) {
      return null;
    }

    const threats: InferenceThreat[] = [];
    if (hasWeapon) threats.push('weapon');
    if (hasFreshViolence) threats.push('violence');

    return {
      alert: Alert.create({
        deviceId: deviceId,
        message: alertMessage,
        imageUrl: imageUrl,
        timeStamp: capturedAt,
        isFalseAlarm: false,
        isSeen: false,
      }),
      threats,
    };
  }

  private buildAlertMessage(hasWeapon: boolean, hasFreshViolence: boolean): string | null {
    if (hasWeapon && hasFreshViolence) {
      return `Violence and weapon detected`;
    }
    if (hasWeapon) {
      return `Weapon detected`;
    }
    if (hasFreshViolence) {
      return `Violence detected`;
    }
    return null;
  }
}
