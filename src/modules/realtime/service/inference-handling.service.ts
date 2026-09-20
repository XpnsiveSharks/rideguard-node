import { Injectable } from '@nestjs/common';
import { InferenceResult } from '../realtime-result';
import { AlertFields } from '@/modules/alerts/domain/alerts.entity';
import { DeviceId } from '@/modules/devices/domain/device-id.value-object';
import { AlertsService } from '@/modules/alerts/alerts.service';
import { RealtimePublisherService } from './realtime-publishing.service';
import { REALTIME_CHANNELS } from '../realtime.constants';
import { DevicesService } from '@/modules/devices/devices.service';
@Injectable()
export class InferenceHandlingService {
  constructor(
    private readonly alertsService: AlertsService,
    private readonly realtimePublisherService: RealtimePublisherService,
    private readonly deviceService: DevicesService,
  ) {}

  async handleResult(result: InferenceResult): Promise<void> {
    // NOTE: add idempotency for event id

    const alert = this.prepareInferenceResult(result);
    const deviceId = alert.deviceId;

    if (alert.message) {
      const newAlert = await this.alertsService.createAlert(alert);

      const assignedUserId = await this.deviceService.findAssignedUserByDeviceId(deviceId);
      const channelName = REALTIME_CHANNELS.alerts(assignedUserId, deviceId);

      await this.realtimePublisherService.publishAlert(channelName, newAlert);
    }
  }

  private prepareInferenceResult(result: InferenceResult): AlertFields {
    const { device_id, captured_at, detections, violence, image } = result;

    const imageUrl = image?.url ?? null;
    const deviceId = DeviceId.create(device_id).toString();
    const capturedAt = new Date(captured_at);
    const hasWeapon = detections.objects.length > 0;
    const hasFreshViolence = violence?.label === 'violent' && violence?.inference_ran === true;
    const alertMessage = this.buildAlertMessage(hasWeapon, hasFreshViolence);

    return {
      deviceId: deviceId,
      message: alertMessage,
      imageUrl: imageUrl,
      timeStamp: capturedAt,
      isFalseAlarm: false,
      isSeen: false,
    };
  }

  private buildAlertMessage(hasWeapon: boolean, hasFreshViolence: boolean): string {
    if (hasWeapon && hasFreshViolence) {
      return `Violence and weapon detected`;
    }
    if (hasWeapon) {
      return `Weapon detected`;
    }
    if (hasFreshViolence) {
      return `Violence detected`;
    }
    return `Nothing was detected here`;
  }
}
