import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InboundMessage } from 'ably';
import { PinoLogger } from 'nestjs-pino';
import { ButtonEventData, parseButtonEvent } from '../button-event';
import { ButtonHandlingService } from './button-handling.service';
import { ButtonSubscriptionService } from './button-subscription.service';

@Injectable()
export class ButtonSubscriberService implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly subscriptions: ButtonSubscriptionService,
    private readonly logger: PinoLogger,
    private readonly buttonHandlingService: ButtonHandlingService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.subscriptions.start(this.handleMessage);
  }

  onModuleDestroy(): void {
    this.subscriptions.stop();
  }

  private readonly handleMessage = (deviceId: string, message: InboundMessage): void => {
    void this.processMessage(deviceId, message).catch(() => {
      this.logger.error({ deviceId, messageId: message.id }, 'Failed to process button event');
    });
  };

  private async processMessage(deviceId: string, message: InboundMessage): Promise<void> {
    const event = this.parseMessage(deviceId, message);
    if (!event) return;

    await this.buttonHandlingService.handleEvent(message.name!, event);
  }

  private parseMessage(deviceId: string, message: InboundMessage): ButtonEventData | null {
    const event = parseButtonEvent(message.name, message.data);
    if (!event || event.device_id !== deviceId || message.clientId !== deviceId) {
      this.logger.warn(
        { deviceId },
        'Rejected invalid button event or mismatched publisher identity',
      );
      return null;
    }

    return event;
  }
}
