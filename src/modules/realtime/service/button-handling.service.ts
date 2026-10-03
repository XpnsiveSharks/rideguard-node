import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ButtonEventData } from '../button-event';

@Injectable()
export class ButtonHandlingService {
  constructor(private readonly logger: PinoLogger) {}

  handleEvent(name: string, event: ButtonEventData): Promise<void> {
    // Add ownership checks and durable event_id deduplication before business side effects.
    this.logger.info({ name, ...event }, 'Button event received');
    return Promise.resolve();
  }
}
