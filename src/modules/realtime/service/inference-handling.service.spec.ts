import type { PinoLogger } from 'nestjs-pino';
import type { AlertsService } from '@/modules/alerts/alerts.service';
import { Alert } from '@/modules/alerts/domain/alerts.entity';
import type { DevicesService } from '@/modules/devices/devices.service';
import type { InferenceResult } from '../types/inference-result';
import type { RealtimePublisherService } from './realtime-publishing.service';
import { InferenceHandlingService } from './inference-handling.service';
import { inferenceResultSchema } from '../validations/inference-result.schema';

const KNIFE = { label: 'knife', confidence: 0.8, box: { x1: 0, y1: 0, x2: 1, y2: 1 } };

function result(overrides: Partial<InferenceResult> = {}): InferenceResult {
  return {
    schema_version: 2,
    event_id: 'event-1',
    device_id: 'CAM-222-BBB',
    captured_at: '2026-10-14T00:00:00Z',
    pose: { person_count: 1 },
    detections: { objects: [] },
    violence: {
      status: 'ok',
      label: 'non_violent',
      confidence: 0.9,
      inference_ran: true,
      alert_eligible: false,
    },
    image: null,
    ...overrides,
  };
}

const savedAlert = Alert.create({
  alertId: 'alert-1',
  deviceId: 'CAM-222-BBB',
  message: 'Weapon detected',
  imageUrl: null,
  timeStamp: new Date('2026-10-14T00:00:00Z'),
  isFalseAlarm: false,
  isSeen: false,
});

function setup(outcome: unknown = { outcome: 'alert_created', alert: savedAlert }) {
  const alertsService = {
    createInferenceAlert: jest.fn().mockResolvedValue(outcome),
    sendAlertPush: jest.fn().mockResolvedValue(undefined),
  };
  const publisher = { publishAlert: jest.fn().mockResolvedValue(undefined) };
  const devices = { findOwnerIdByDeviceId: jest.fn().mockResolvedValue('user-1') };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const service = new InferenceHandlingService(
    alertsService as unknown as AlertsService,
    publisher as unknown as RealtimePublisherService,
    devices as unknown as DevicesService,
    logger as unknown as PinoLogger,
  );
  return { service, alertsService, publisher, devices, logger };
}

describe('InferenceHandlingService', () => {
  it('sends negative observations to the transaction without notifying', async () => {
    const { service, alertsService, publisher } = setup({ outcome: 'ignored_no_threat' });

    await service.handleResult(result());

    expect(alertsService.createInferenceAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        weaponLabels: [],
        hasFreshViolence: false,
        observationVersion: 2,
      }),
    );
    expect(publisher.publishAlert).not.toHaveBeenCalled();
  });

  it('creates no alert for cached violence', async () => {
    const { service, alertsService } = setup({ outcome: 'ignored_no_threat' });

    await service.handleResult(
      result({
        violence: { status: 'ok', label: 'violent', confidence: 0.9, inference_ran: false },
      }),
    );

    expect(alertsService.createInferenceAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        hasFreshViolence: false,
      }),
    );
  });

  it('passes all qualifying threat types to the transaction', async () => {
    const { service, alertsService } = setup();

    await service.handleResult(
      result({
        detections: { objects: [KNIFE] },
        violence: {
          status: 'ok',
          label: 'violent',
          confidence: 0.9,
          inference_ran: true,
          alert_eligible: true,
        },
      }),
    );

    expect(alertsService.createInferenceAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-1',
        weaponLabels: ['knife'],
        hasFreshViolence: true,
      }),
    );
  });

  it('delivers a newly created alert by push and Ably', async () => {
    const { service, alertsService, publisher } = setup();

    await service.handleResult(result({ detections: { objects: [KNIFE] } }));

    expect(alertsService.sendAlertPush).toHaveBeenCalledWith(savedAlert, 'user-1', 'event-1');
    expect(publisher.publishAlert).toHaveBeenCalledWith(
      'rideguard:alerts:user:user-1:device:CAM-222-BBB',
      savedAlert,
    );
  });

  it.each([
    'duplicate',
    'suppressed_cooldown',
    'awaiting_confirmation',
    'ignored_stale',
    'awaiting_observations',
  ])('does not deliver a %s event', async (kind) => {
    const { service, alertsService, publisher } = setup({ outcome: kind });

    await service.handleResult(result({ detections: { objects: [KNIFE] } }));

    expect(alertsService.sendAlertPush).not.toHaveBeenCalled();
    expect(publisher.publishAlert).not.toHaveBeenCalled();
  });

  it('logs and skips an event ID that belongs to another camera', async () => {
    const { service, publisher, logger } = setup({
      outcome: 'event_conflict',
      existingDeviceId: 'CAM-111-AAA',
    });

    await service.handleResult(result({ detections: { objects: [KNIFE] } }));

    expect(publisher.publishAlert).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('delivers nothing when no transaction committed', async () => {
    const { service, alertsService, publisher } = setup();
    alertsService.createInferenceAlert.mockRejectedValue(new Error('commit failed'));

    await expect(
      service.handleResult(result({ detections: { objects: [KNIFE] } })),
    ).rejects.toThrow('commit failed');
    expect(alertsService.sendAlertPush).not.toHaveBeenCalled();
    expect(publisher.publishAlert).not.toHaveBeenCalled();
  });

  it('keeps the alert saved and logs when Ably fails', async () => {
    const { service, publisher, logger } = setup();
    publisher.publishAlert.mockRejectedValue(new Error('ably down'));

    await expect(
      service.handleResult(result({ detections: { objects: [KNIFE] } })),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'event-1', alertId: 'alert-1' }),
      'Realtime alert not delivered',
    );
  });

  it('skips delivery when the camera has no assigned user', async () => {
    const { service, alertsService, publisher, devices, logger } = setup();
    devices.findOwnerIdByDeviceId.mockResolvedValue(null);

    await service.handleResult(result({ detections: { objects: [KNIFE] } }));

    expect(alertsService.sendAlertPush).not.toHaveBeenCalled();
    expect(publisher.publishAlert).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('preserves the producer confidence gate for weak fresh violence', async () => {
    const { service, alertsService } = setup({ outcome: 'ignored_no_threat' });
    await service.handleResult(
      result({
        violence: {
          status: 'ready',
          label: 'violent',
          confidence: 0.6,
          inference_ran: true,
          alert_eligible: false,
        },
      }),
    );
    expect(alertsService.createInferenceAlert).toHaveBeenCalledWith(
      expect.objectContaining({ hasFreshViolence: false }),
    );
  });

  it('accepts legacy violence during producer rollout', async () => {
    const { service, alertsService } = setup();
    await service.handleResult(
      result({
        schema_version: undefined,
        violence: { status: 'ready', label: 'violent', confidence: 0.9, inference_ran: true },
      }),
    );
    expect(alertsService.createInferenceAlert).toHaveBeenCalledWith(
      expect.objectContaining({ hasFreshViolence: true }),
    );
  });
});

describe('versioned inference contract', () => {
  it('accepts v2 negative observations with subsecond timestamps', () => {
    const event = result({ captured_at: '2026-10-15T01:02:03.456789Z' });
    expect(inferenceResultSchema.validate(event, { convert: false }).error).toBeUndefined();
  });

  it('requires the violence confidence decision for v2', () => {
    const event = result();
    delete event.violence.alert_eligible;
    expect(inferenceResultSchema.validate(event).error).toBeDefined();
  });

  it('still accepts the legacy payload without version or eligibility', () => {
    const event = result();
    delete event.schema_version;
    delete event.violence.alert_eligible;
    expect(inferenceResultSchema.validate(event).error).toBeUndefined();
  });
});
