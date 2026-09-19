import { Injectable, Inject } from '@nestjs/common';
import { Rest } from 'ably';
import { ABLY_REST } from '@/infra/ably/ably.constants';
import { PinoLogger } from 'nestjs-pino';
import { Alert } from '@/modules/alerts/domain/alerts.entity';
import { ALERT_EVENTS } from '@/modules/alerts/alerts.constants';

@Injectable()
export class RealtimePublisherService {
  constructor(
    @Inject(ABLY_REST)
    private readonly ably: Rest,
    private readonly logger: PinoLogger,
  ) {}

  async publishAlert(channelName: string, data: Alert): Promise<void> {
    const alertFields = data.alertFields;

    try {
      const channel = this.ably.channels.get(channelName);
      await channel.publish(ALERT_EVENTS.ALERT_CREATED, alertFields);
    } catch (error: unknown) {
      this.logger.error(
        { err: error, channel: channelName, event: ALERT_EVENTS.ALERT_FAILED },
        'Failed to publish realtime alert',
      );

      throw error;
    }
  }
}
