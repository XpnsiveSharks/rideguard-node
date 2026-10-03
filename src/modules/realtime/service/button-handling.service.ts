import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { ButtonEventData, ButtonEventName } from '../types/button-event.types';

@Injectable()
export class ButtonHandlingService {
  constructor(private readonly logger: PinoLogger) {}

  // Handles a validated button event. The subscriber already picked the schema
  // by event name and validated the payload, so this is where button business
  // logic (capture, SOS lifecycle, alerts) will be added.
  handleEvent(eventName: ButtonEventName, data: ButtonEventData): Promise<void> {
    this.logger.info(
      { event: eventName, deviceId: data.device_id, eventId: data.event_id },
      `Received button event ${eventName} from ${data.device_id}`,
    );

    return Promise.resolve();
  }
}
