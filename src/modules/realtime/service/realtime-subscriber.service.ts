import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InboundMessage, Realtime, RealtimeChannel } from 'ably';
import { PinoLogger } from 'nestjs-pino';
import { ABLY_REALTIME } from '@/infra/ably/ably.constants';
import { InferenceHandlingService } from './inference-handling.service';
import { ButtonHandlingService } from './button-handling.service';
import { REALTIME_CHANNELS, INFERENCE_EVENT_NAME, BUTTON_EVENT_NAMES } from '../realtime.constants';
import { inferenceResultSchema } from '../validations/inference-result.schema';
import { buttonEventSchemas } from '../validations/button-events.schema';
import type { ButtonEventName } from '../types/button-event.types';

function isButtonEventName(name: string | undefined): name is ButtonEventName {
  return !!name && (BUTTON_EVENT_NAMES as readonly string[]).includes(name);
}

@Injectable()
export class RealtimeSubscriberService implements OnModuleInit, OnModuleDestroy {
  private inferenceChannel?: RealtimeChannel;
  private buttonChannel?: RealtimeChannel;

  constructor(
    @Inject(ABLY_REALTIME)
    private readonly realtime: Realtime,
    private readonly logger: PinoLogger,
    private readonly inferenceHandlingService: InferenceHandlingService,
    private readonly buttonHandlingService: ButtonHandlingService,
  ) {}

  // *** MODULE LIFECYCLE HOOKS ***
  async onModuleInit(): Promise<void> {
    this.inferenceChannel = this.realtime.channels.get(REALTIME_CHANNELS.inferenceResults);
    this.logger.info(`Subscribing to channel: ${REALTIME_CHANNELS.inferenceResults}`);
    await this.inferenceChannel.subscribe(
      INFERENCE_EVENT_NAME.inferenceResult,
      this.handleInferenceMessage,
    );

    const buttonChannel = this.realtime.channels.get(REALTIME_CHANNELS.buttonEvents);
    this.buttonChannel = buttonChannel;
    this.logger.info(`Subscribing to channel: ${REALTIME_CHANNELS.buttonEvents}`);
    await Promise.all(
      BUTTON_EVENT_NAMES.map((eventName) =>
        buttonChannel.subscribe(eventName, this.handleButtonEventMessage),
      ),
    );
  }

  onModuleDestroy(): void {
    this.inferenceChannel?.unsubscribe(
      INFERENCE_EVENT_NAME.inferenceResult,
      this.handleInferenceMessage,
    );
    for (const eventName of BUTTON_EVENT_NAMES) {
      this.buttonChannel?.unsubscribe(eventName, this.handleButtonEventMessage);
    }
    this.realtime.close();
  }

  // *** INFERENCE RESULT HANDLING ***
  private readonly handleInferenceMessage = (message: InboundMessage): void => {
    void this.processInferenceMessage(message).catch((error: unknown) => {
      this.logger.error(
        { err: error, messageId: message.id },
        'Failed to process inference result',
      );
    });
  };

  private async processInferenceMessage(message: InboundMessage): Promise<void> {
    const validation = inferenceResultSchema.validate(message.data, {
      abortEarly: false,
      convert: false,
    });

    if (validation.error) {
      throw new Error(`Invalid inference result: ${validation.error.message}`);
    }

    await this.inferenceHandlingService.handleResult(validation.value);
  }

  // *** BUTTON EVENT HANDLING ***
  private readonly handleButtonEventMessage = (message: InboundMessage): void => {
    void this.processButtonEventMessage(message).catch((error: unknown) => {
      this.logger.error(
        { err: error, messageId: message.id, event: message.name },
        'Failed to process button event',
      );
    });
  };

  private async processButtonEventMessage(message: InboundMessage): Promise<void> {
    const eventName = message.name;
    if (!isButtonEventName(eventName)) {
      throw new Error(`Unknown button event: ${eventName ?? '(none)'}`);
    }

    // Each event name has its own strict schema (see button-events.schema.ts).
    const validation = buttonEventSchemas[eventName].validate(message.data, {
      abortEarly: false,
      convert: false,
    });

    if (validation.error) {
      throw new Error(`Invalid button event: ${validation.error.message}`);
    }

    await this.buttonHandlingService.handleEvent(eventName, validation.value);
  }
}
