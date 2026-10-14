import { Injectable } from '@nestjs/common';
import { InferenceResult } from '../types/inference-result';
import { Alert } from '@/modules/alerts/domain/alerts.entity';
import { DeviceId } from '@/modules/devices/domain/device-id.value-object';
import { AlertsService } from '@/modules/alerts/alerts.service';
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
    const eventId = result.event_id;
    const deviceId = DeviceId.create(result.device_id).toString();
    const violence = result.violence;
    const outcome = await this.alertsService.createInferenceAlert({
      eventId,
      deviceId,
      capturedAt: new Date(result.captured_at),
      imageUrl: result.image?.url ?? null,
      weaponLabels: result.detections.objects.map((object) => object.label),
      observationVersion: result.schema_version,
      // V2 also publishes weak violence results. Preserve the model's threshold.
      hasFreshViolence:
        violence.label === 'violent' &&
        violence.inference_ran === true &&
        (result.schema_version !== 2 || violence.alert_eligible === true),
      // Captured once, outside the transaction, so a retry reuses it.
      processedAt: new Date(),
    });

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
}
