import { Injectable } from '@nestjs/common';
import { InferenceResult } from '../inference-result';
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
    const objectConfidence = detections.objects.reduce((acc, obj) => acc + obj.confidence, 0);
    const alertMessage = this.buildAlertMessage(violence?.confidence ?? 0, objectConfidence);

    if (imageUrl) {
      const alert = Alert.create({
        deviceId: deviceId,
        message: alertMessage,
        imageUrl: imageUrl,
        timeStamp: capturedAt,
        isFalseAlarm: false,
        isSeen: false,
      });

      await this.alertsService.createAlert(alert);
      // NOTE: add live map here
    }
  }

  private buildAlertMessage(violenceConfidence: number, objectConfidence: number): string {
    if (violenceConfidence > 0 && objectConfidence > 0) {
      return `Violence and weapon detected`;
    }
    if (violenceConfidence > 0 && objectConfidence === 0) {
      return `Violence detected`;
    }
    if (violenceConfidence === 0 && objectConfidence > 0) {
      return `Weapon detected`;
    }
    return `No threat detected`;
  }
}
