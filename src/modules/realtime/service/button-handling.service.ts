import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@/config/env.validation';
import { PinoLogger } from 'nestjs-pino';
import type { ButtonEventData, ButtonEventName } from '../types/button-event.types';
import { DevicesService } from '@/modules/devices/devices.service';
import { SosService } from '@/modules/sos/sos.service';
import { RealtimePublisherService } from './realtime-publishing.service';
import { REALTIME_CHANNELS, SOS_EVENTS } from '../realtime.constants';

// In-process stale-press tracking. The subscriber is single-process; this only
// closes the retry/out-of-order gap, not a multi-instance one.
type LastPress = { occurredAt: number };

@Injectable()
export class ButtonHandlingService {
  private readonly lastSosByDevice = new Map<string, LastPress>();
  private readonly lastCancelByDevice = new Map<string, LastPress>();

  constructor(
    private readonly logger: PinoLogger,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    private readonly devicesService: DevicesService,
    private readonly sosService: SosService,
    private readonly realtimePublisherService: RealtimePublisherService,
  ) {}

  async handleEvent(eventName: ButtonEventName, data: ButtonEventData): Promise<void> {
    // Only button.pressed carries an actionable press_type. The hold lifecycle
    // events (press_started / press_released) are telemetry for the phone's
    // optional hold indicator and need no SOS work here.
    if (eventName !== 'button.pressed') {
      this.logger.info(
        { event: eventName, deviceId: data.device_id, eventId: data.event_id },
        `Received button event ${eventName} from ${data.device_id}`,
      );
      return;
    }

    const pressType = data.press_type;
    if (pressType !== 'SOS' && pressType !== 'CANCEL_SOS') {
      this.logger.info(
        { event: eventName, deviceId: data.device_id, eventId: data.event_id, pressType },
        `Received button event ${eventName} from ${data.device_id}`,
      );
      return;
    }

    const occurredAt = Date.parse(data.occurred_at);

    const ownerId = await this.devicesService.findOwnerIdByDeviceId(data.device_id);
    if (!ownerId) {
      this.logger.info(
        { event: eventName, deviceId: data.device_id, eventId: data.event_id, pressType },
        'Button press ignored: device has no assigned rider',
      );
      return;
    }

    if (pressType === 'SOS') {
      const pressId = data.press_id;
      if (!pressId) {
        this.logger.warn(
          { deviceId: data.device_id, eventId: data.event_id },
          'SOS press missing press_id; ignored',
        );
        return;
      }

      // Stale-press guard: a cancel that was processed later in wall-clock time
      // wins; an SOS older than it must not resurrect the SOS.
      const lastCancel = this.lastCancelByDevice.get(data.device_id);
      if (lastCancel && occurredAt < lastCancel.occurredAt) {
        this.logger.info(
          { deviceId: data.device_id, eventId: data.event_id, pressId },
          'SOS press ignored: older than a processed cancel',
        );
        return;
      }

      if (!this.configService.get('SOS_ENABLED', { infer: true })) {
        this.logger.info(
          { deviceId: data.device_id, eventId: data.event_id, pressId },
          'SOS press ignored: SOS disabled',
        );
        return;
      }

      try {
        const result = await this.sosService.start(ownerId, {
          requestId: pressId,
          location: null,
        });
        this.lastSosByDevice.set(data.device_id, { occurredAt });

        try {
          await this.realtimePublisherService.publishSosState(
            REALTIME_CHANNELS.sos(ownerId),
            {
              sosId: result.sos.sosId,
              status: result.sos.status as 'active' | 'ended',
              requestId: result.sos.requestId,
            },
          );
        } catch {
          // Publishing is best-effort; the phone reconciles via polling.
        }
      } catch (error: unknown) {
        this.logger.warn(
          {
            err: error instanceof Error ? error.message : error,
            deviceId: data.device_id,
            eventId: data.event_id,
            pressId,
          },
          'SOS press failed to start SOS',
        );
      }
      return;
    }

    // CANCEL_SOS
    const lastSos = this.lastSosByDevice.get(data.device_id);
    if (lastSos && occurredAt < lastSos.occurredAt) {
      this.logger.info(
        { deviceId: data.device_id, eventId: data.event_id },
        'Cancel press ignored: older than a processed SOS',
      );
      return;
    }

    let active;
    try {
      active = await this.sosService.getActive(ownerId);
    } catch (error: unknown) {
      this.logger.warn(
        { err: error instanceof Error ? error.message : error, deviceId: data.device_id },
        'Cancel press: active lookup failed',
      );
      return;
    }

    if (!active) {
      this.logger.info(
        { deviceId: data.device_id, eventId: data.event_id },
        'Cancel press ignored: no active SOS',
      );
      this.lastCancelByDevice.set(data.device_id, { occurredAt });
      return;
    }

    try {
      const stopped = await this.sosService.stop(ownerId, active.sosId);
      this.lastCancelByDevice.set(data.device_id, { occurredAt });

      try {
        await this.realtimePublisherService.publishSosState(
          REALTIME_CHANNELS.sos(ownerId),
          {
            sosId: stopped.sosId,
            status: stopped.status as 'active' | 'ended',
            requestId: stopped.requestId,
          },
        );
      } catch {
        // Publishing is best-effort; the phone reconciles via polling.
      }
    } catch (error: unknown) {
      this.logger.warn(
        { err: error instanceof Error ? error.message : error, deviceId: data.device_id, sosId: active.sosId },
        'Cancel press failed to stop SOS',
      );
    }
  }
}