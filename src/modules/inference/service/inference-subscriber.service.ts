import { Injectable, Inject } from '@nestjs/common';
import { InboundMessage, Realtime, RealtimeChannel } from 'ably';
import { Logger } from 'nestjs-pino';
import { inferenceResultSchema } from '../inference-result.schema';
import { InferenceResult } from '../inference-result';
import { ABLY_REALTIME } from '@/infra/ably/ably.constants';

const CHANNEL_NAME = 'rideguard-inference-results';
const EVENT_NAME = 'inference.result';

@Injectable()
export class InferenceSubscriberService {
  private channel?: RealtimeChannel;
  constructor(
    @Inject(ABLY_REALTIME)
    private readonly realtime: Realtime,
    private readonly logger: Logger,
  ) {}

  async onModuleInit(): Promise<void> {
    this.channel = this.realtime.channels.get(CHANNEL_NAME);
    this.logger.log(`Subscribing to channel: ${CHANNEL_NAME}`);
    await this.channel.subscribe(EVENT_NAME, this.handleMessage);
  }

  onModuleDestroy(): void {
    this.channel?.unsubscribe(EVENT_NAME, this.handleMessage);
    this.realtime.close();
  }

  private readonly handleMessage = (message: InboundMessage): void => {
    try {
      this.processMessage(message);
    } catch (error: unknown) {
      this.logger.error(
        { err: error, messageId: message.id },
        'Failed to process inference result',
      );
    }
  };

  private processMessage(message: InboundMessage): void {
    const result = this.parseMessage(message.data);
    this.logger.debug(`Received inference result: ${JSON.stringify(result)}`);
    // add idempotency here
    // other processing logic for the inference result can be added here
  }

  private parseMessage(data: unknown): InferenceResult {
    const validation = inferenceResultSchema.validate(data, {
      abortEarly: false,
      convert: false,
    });

    if (validation.error) {
      throw new Error(`Invalid inference result: ${validation.error.message}`);
    }

    return validation.value;
  }
}
