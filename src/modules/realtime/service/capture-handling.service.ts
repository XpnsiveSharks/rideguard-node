import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { CaptureImageEvent, CaptureSkippedEvent } from '../types/capture-event';

@Injectable()
export class CaptureHandlingService {
  constructor(private readonly logger: PinoLogger) {}

  // Handles a validated capture.image. The subscriber already validated the
  // payload, so this is where capture business logic (persist, forward to the
  // user) will be added.
  handleImage(data: CaptureImageEvent): Promise<void> {
    this.logger.info(
      {
        captureId: data.capture_id,
        buttonId: data.button_id,
        cameraId: data.camera_id,
        sequence: data.sequence,
        url: data.image.url,
      },
      `Received capture image ${data.sequence} for ${data.camera_id}`,
    );

    return Promise.resolve();
  }

  // Handles a validated capture.skipped: the press produced no frames, either
  // because no camera is registered or because the resolver was unavailable.
  handleSkipped(data: CaptureSkippedEvent): Promise<void> {
    this.logger.info(
      { captureId: data.capture_id, buttonId: data.button_id, status: data.status },
      `Capture skipped for ${data.button_id}: ${data.status}`,
    );

    return Promise.resolve();
  }
}
