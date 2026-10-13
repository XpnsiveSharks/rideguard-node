import { UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@/config/env.validation';
import type { PinoLogger } from 'nestjs-pino';
import {
  Device,
  DeviceFields,
  DeviceSource,
  DeviceStatus,
  DeviceType,
} from './domain/device.entity';
import { hashDeviceSecret } from './infrastructure/device-secret';
import type {
  PhoneCameraRepository,
  PhoneSessionRecord,
} from './infrastructure/phone-cameras.repository';
import { PHONE_SESSION_GRACE_MS } from './device.constants';
import { PhoneCameraService } from './phone-camera.service';

const DEVICE_ID = 'CAM-123-ABC';
const MAX_DURATION_MS = 600_000;

function phone(overrides: Partial<DeviceFields> = {}): Device {
  return Device.reconstitute({
    deviceId: DEVICE_ID,
    deviceType: DeviceType.CAMERA,
    status: DeviceStatus.PROVISIONED,
    source: DeviceSource.PHONE,
    assignedUserId: 'user-1',
    installationId: 'install-1234',
    activeSessionId: 'session-1',
    connected: false,
    ...overrides,
  });
}

function session(overrides: Partial<PhoneSessionRecord> = {}): PhoneSessionRecord {
  return {
    sessionId: 'session-1',
    deviceId: DEVICE_ID,
    userId: 'user-1',
    tokenHash: hashDeviceSecret('secret'),
    startedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    endedAt: null,
    endReason: null,
    ...overrides,
  };
}

function setup() {
  const repository = {
    findOrCreate: jest.fn(),
    startSession: jest.fn<Promise<void>, [PhoneSessionRecord]>().mockResolvedValue(undefined),
    endSession: jest.fn().mockResolvedValue(undefined),
    findSession: jest.fn().mockResolvedValue(session()),
    findDevice: jest.fn().mockResolvedValue(phone()),
    updatePresence: jest.fn().mockResolvedValue(true),
  };
  const config = { get: jest.fn().mockReturnValue(MAX_DURATION_MS) };
  const service = new PhoneCameraService(
    repository as unknown as PhoneCameraRepository,
    config as unknown as ConfigService<EnvironmentVariables, true>,
    { info: jest.fn() } as unknown as PinoLogger,
  );
  return { service, repository };
}

describe('PhoneCameraService', () => {
  describe('registerPhoneCamera', () => {
    it('returns the existing camera on retry', async () => {
      const { service, repository } = setup();
      repository.findOrCreate.mockResolvedValue({ device: phone(), created: false });

      await expect(service.registerPhoneCamera('user-1', 'install-1234')).resolves.toEqual({
        device_id: DEVICE_ID,
        source: DeviceSource.PHONE,
        created: false,
      });
      expect(repository.findOrCreate).toHaveBeenCalledWith('user-1', 'install-1234');
    });

    it('requires a signed-in user', async () => {
      const { service } = setup();
      await expect(service.registerPhoneCamera(undefined, 'install-1234')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });
  });

  describe('startSession', () => {
    it('stores only the token hash and expires after duration plus grace', async () => {
      const { service, repository } = setup();
      const before = Date.now();

      const result = await service.startSession('user-1', DEVICE_ID, MAX_DURATION_MS);

      const [sessionId, secret] = result.upload_token.split('.');
      const [stored] = repository.startSession.mock.calls[0];
      expect(stored.sessionId).toBe(sessionId);
      expect(stored.tokenHash).toBe(hashDeviceSecret(secret));
      expect(JSON.stringify(stored)).not.toContain(secret);
      const expiresAt = new Date(result.expires_at).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(before + MAX_DURATION_MS + PHONE_SESSION_GRACE_MS);
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + MAX_DURATION_MS + PHONE_SESSION_GRACE_MS);
    });

    it('rejects durations above the server maximum', async () => {
      const { service, repository } = setup();
      await expect(
        service.startSession('user-1', DEVICE_ID, MAX_DURATION_MS + 1),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(repository.startSession).not.toHaveBeenCalled();
    });
  });

  describe('verifyUploadToken', () => {
    it('accepts a valid token for the active session', async () => {
      const { service } = setup();
      await expect(service.verifyUploadToken('session-1.secret')).resolves.toMatchObject({
        device_id: DEVICE_ID,
        session_id: 'session-1',
      });
    });

    it.each<[string, string, Partial<PhoneSessionRecord>, Partial<DeviceFields>]>([
      ['a wrong secret', 'session-1.wrong', {}, {}],
      ['a malformed token', 'session-1', {}, {}],
      ['an ended session', 'session-1.secret', { endedAt: new Date() }, {}],
      ['an expired session', 'session-1.secret', { expiresAt: new Date(Date.now() - 1) }, {}],
      ['a superseded session', 'session-1.secret', {}, { activeSessionId: 'session-2' }],
      ['a camera owned by another account', 'session-1.secret', {}, { assignedUserId: 'user-2' }],
      ['a non-phone camera', 'session-1.secret', {}, { source: DeviceSource.ESP32 }],
    ])('rejects %s', async (_label, token, sessionOverrides, deviceOverrides) => {
      const { service, repository } = setup();
      repository.findSession.mockResolvedValue(session(sessionOverrides));
      repository.findDevice.mockResolvedValue(phone(deviceOverrides));

      await expect(service.verifyUploadToken(token)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('reportPresence', () => {
    it('records presence for the active session', async () => {
      const { service, repository } = setup();
      await service.reportPresence('session-1', true);
      expect(repository.updatePresence).toHaveBeenCalledWith(DEVICE_ID, 'session-1', true);
    });

    it('tells model-api to close a stream whose session was replaced', async () => {
      const { service, repository } = setup();
      repository.updatePresence.mockResolvedValue(false);
      await expect(service.reportPresence('session-1', true)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('accepts a disconnect for an ended session', async () => {
      const { service, repository } = setup();
      repository.findSession.mockResolvedValue(session({ endedAt: new Date() }));
      await expect(service.reportPresence('session-1', false)).resolves.toBeUndefined();
    });
  });
});
