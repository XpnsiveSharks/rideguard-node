import { Inject, Injectable } from '@nestjs/common';
import { InboundMessage, Realtime, RealtimeChannel } from 'ably';
import { PinoLogger } from 'nestjs-pino';
import { ABLY_BUTTON_REALTIME } from '@/infra/ably/ably.constants';
import { DevicesService } from '@/modules/devices/devices.service';
import { BUTTON_EVENT_NAMES } from '../button-event';
import { REALTIME_CHANNELS } from '../realtime.constants';
import { HALF_MINUTE_IN_MILLISECONDS } from '@/common/constants/time.constants';

interface ButtonSubscription {
  channel: RealtimeChannel;
  listener: (message: InboundMessage) => void;
}

type ButtonMessageListener = (deviceId: string, message: InboundMessage) => void;

@Injectable()
export class ButtonSubscriptionService {
  private readonly subscriptions = new Map<string, ButtonSubscription>();
  private registeredDeviceIds = new Set<string>();
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(
    @Inject(ABLY_BUTTON_REALTIME) private readonly realtime: Realtime,
    private readonly devicesService: DevicesService,
    private readonly logger: PinoLogger,
  ) {}

  async start(listener: ButtonMessageListener): Promise<void> {
    await this.refreshSubscriptions(listener);
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.refreshTimer);
    for (const { channel, listener } of this.subscriptions.values()) {
      channel.unsubscribe(listener);
    }
    this.subscriptions.clear();
    this.registeredDeviceIds.clear();
    // This connection is separate from the inference subscriber's connection.
    this.realtime.close();
  }

  private async refreshSubscriptions(listener: ButtonMessageListener): Promise<void> {
    try {
      const registeredIds = await this.devicesService.findButtonDeviceIds();
      if (this.stopped) return;

      const deviceIds = new Set(registeredIds.filter((id) => /^BUT-\d{3}-[A-Z]{3}$/.test(id)));
      this.registeredDeviceIds = deviceIds;
      for (const [deviceId, subscription] of this.subscriptions) {
        if (!deviceIds.has(deviceId) || subscription.channel.state === 'failed') {
          await this.removeSubscription(deviceId, subscription);
        }
      }

      if (this.stopped) return;
      await Promise.all(
        [...deviceIds]
          .filter((id) => !this.subscriptions.has(id))
          .map((id) => this.subscribe(id, listener)),
      );
    } catch {
      this.logger.error('Could not refresh button subscriptions; retrying in 30 seconds');
    } finally {
      if (!this.stopped) {
        // Schedule after completion so slow discovery/attachment cannot overlap.
        this.refreshTimer = setTimeout(
          () => void this.refreshSubscriptions(listener),
          HALF_MINUTE_IN_MILLISECONDS,
        );
        this.refreshTimer.unref();
      }
    }
  }

  private async subscribe(deviceId: string, onMessage: ButtonMessageListener): Promise<void> {
    const channel = this.realtime.channels.get(REALTIME_CHANNELS.buttonEvents(deviceId));
    const listener = (message: InboundMessage): void => {
      if (this.stopped || !this.registeredDeviceIds.has(deviceId)) return;
      onMessage(deviceId, message);
    };
    this.subscriptions.set(deviceId, { channel, listener });

    try {
      await channel.subscribe([...BUTTON_EVENT_NAMES], listener);
      if (!this.stopped) {
        this.logger.info({ deviceId, channel: channel.name }, 'Subscribed to button events');
      }
    } catch {
      channel.unsubscribe(listener);
      this.subscriptions.delete(deviceId);
      if (!this.stopped) {
        this.logger.error(
          { deviceId, channel: channel.name },
          'Could not subscribe to button events; check ABLY_API_KEY subscribe capability. Will retry.',
        );
      }
    }
  }

  private async removeSubscription(
    deviceId: string,
    subscription: ButtonSubscription,
  ): Promise<void> {
    try {
      if (!['initialized', 'detached', 'failed'].includes(subscription.channel.state)) {
        await subscription.channel.detach();
      }
      subscription.channel.unsubscribe(subscription.listener);
      if (!this.stopped) this.realtime.channels.release(subscription.channel.name);
      this.subscriptions.delete(deviceId);
    } catch {
      // Leave the entry in place so the next refresh retries detachment.
      if (!this.stopped) this.logger.warn({ deviceId }, 'Could not detach removed button channel');
    }
  }
}
