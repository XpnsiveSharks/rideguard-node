import type { PinoLogger } from 'nestjs-pino';
import type { AlertsService } from '@/modules/alerts/alerts.service';
import type { DevicesService } from '@/modules/devices/devices.service';
import type { InferenceResult } from '../types/inference-result';
import type { RealtimePublisherService } from './realtime-publishing.service';
import { InferenceHandlingService } from './inference-handling.service';

function result(overrides: Partial<InferenceResult> = {}): InferenceResult {
  return {
    event_id: 'event-1',
    device_id: 'CAM-222-BBB',
    captured_at: '2026-10-14T00:00:00Z',
    pose: { person_count: 1 },
    detections: { objects: [] },
    violence: { status: 'ok', label: 'non_violent', confidence: 0.9, inference_ran: true },
    image: null,
    ...overrides,
  };
}

function setup() {
  const alertsService = { createAlert: jest.fn().mockImplementation((alert: unknown) => alert) };
  const publisher = { publishAlert: jest.fn().mockResolvedValue(undefined) };
  const devices = { findAssignedUserByDeviceId: jest.fn().mockResolvedValue('user-1') };
  const service = new InferenceHandlingService(
    alertsService as unknown as AlertsService,
    publisher as unknown as RealtimePublisherService,
    devices as unknown as DevicesService,
    { info: jest.fn() } as unknown as PinoLogger,
  );
  return { service, alertsService, publisher };
}

describe('InferenceHandlingService', () => {
  it('creates no alert for a result without a threat', async () => {
    const { service, alertsService, publisher } = setup();

    await service.handleResult(result());

    expect(alertsService.createAlert).not.toHaveBeenCalled();
    expect(publisher.publishAlert).not.toHaveBeenCalled();
  });

  it('alerts the camera owner on a weapon detection', async () => {
    const { service, alertsService, publisher } = setup();

    await service.handleResult(
      result({
        detections: {
          objects: [{ label: 'knife', confidence: 0.8, box: { x1: 0, y1: 0, x2: 1, y2: 1 } }],
        },
      }),
    );

    expect(alertsService.createAlert).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'CAM-222-BBB', message: 'Weapon detected' }),
    );
    expect(publisher.publishAlert).toHaveBeenCalledWith(
      'rideguard:alerts:user:user-1:device:CAM-222-BBB',
      expect.anything(),
    );
  });
});
