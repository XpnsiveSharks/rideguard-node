import { Injectable } from '@nestjs/common';
import { InferenceResult } from '../realtime-result';
import { Alert } from '@/modules/alerts/domain/alerts.entity';
import { DeviceId } from '@/modules/devices/domain/device-id.value-object';
import { Logger } from 'nestjs-pino';
import { AlertsService } from '@/modules/alerts/alerts.service';

@Injectable()
export class InferenceHandlingService {
  constructor(
    private readonly logger: Logger,
    private readonly alertsService: AlertsService,
  ) {}
  async handleResult(result: InferenceResult): Promise<void> {
    // NOTE: add idempotency for event id

    const { device_id, captured_at, detections, violence, image } = result;
    const imageUrl = image?.url ?? null;
    const deviceId = DeviceId.create(device_id).toString();
    const capturedAt = new Date(captured_at);
    const hasWeapon = detections.objects.length > 0;
    const hasFreshViolence = violence?.label === 'violent' && violence?.inference_ran === true;
    const alertMessage = this.buildAlertMessage(hasWeapon, hasFreshViolence);

    if (imageUrl && alertMessage) {
      const alert = Alert.create({
        deviceId: deviceId,
        message: alertMessage,
        imageUrl: imageUrl,
        timeStamp: capturedAt,
        isFalseAlarm: false,
        isSeen: false,
      });

      this.logger.log(`Creating alert for device ${JSON.stringify(alert)}`);

      await this.alertsService.createAlert(alert);
      // NOTE: add live map here
    }
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
