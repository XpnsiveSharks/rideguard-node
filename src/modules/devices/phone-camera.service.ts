import { Injectable, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { PinoLogger } from 'nestjs-pino';
import type { EnvironmentVariables } from '@/config/env.validation';
import { DeviceId } from './domain/device-id.value-object';
import { DeviceSource } from './domain/device.entity';
import { PhoneCameraRepository } from './infrastructure/phone-cameras.repository';
import { generateDeviceSecret, hashDeviceSecret } from './infrastructure/device-secret';
import { PHONE_EVENTS, PHONE_SESSION_GRACE_MS } from './device.constants';
import type { PhoneCameraView, PhoneSessionView, VerifiedPhoneUpload } from './devices.types';

const INVALID_UPLOAD_TOKEN = 'Invalid upload token';

function requireUserId(userId: string | undefined): string {
  const normalized = userId?.trim();
  if (!normalized) {
    throw new UnprocessableEntityException(
      'We could not verify your account. Please log in again.',
    );
  }
  return normalized;
}

@Injectable()
export class PhoneCameraService {
  constructor(
    private readonly repository: PhoneCameraRepository,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    private readonly logger: PinoLogger,
  ) {}

  // *** REGISTER THIS INSTALLATION'S PHONE CAMERA - MOBILE ***
  // Safe to retry: the same user and installation always get the same camera.
  async registerPhoneCamera(
    userId: string | undefined,
    installationId: string,
  ): Promise<PhoneCameraView> {
    const owner = requireUserId(userId);
    const { device, created } = await this.repository.findOrCreate(owner, installationId);

    if (created) {
      this.logger.info(
        { event: PHONE_EVENTS.PHONE_CAMERA_REGISTERED },
        `Phone camera registered: ${device.getDeviceId()}`,
      );
    }

    return { device_id: device.getDeviceId(), source: DeviceSource.PHONE, created };
  }

  // *** START A PHONE UPLOAD SESSION - MOBILE ***
  // The raw token is returned once. Only its hash is stored.
  async startSession(
    userId: string | undefined,
    deviceId: string,
    durationMs: number,
  ): Promise<PhoneSessionView> {
    const owner = requireUserId(userId);
    const normalizedId = DeviceId.create(deviceId).toString();
    const maxDuration = this.configService.get('PHONE_SESSION_MAX_DURATION_MS', { infer: true });
    if (durationMs > maxDuration) {
      throw new UnprocessableEntityException(
        `duration_ms must not exceed ${maxDuration} milliseconds`,
      );
    }

    const sessionId = randomUUID();
    const secret = generateDeviceSecret();
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + durationMs + PHONE_SESSION_GRACE_MS);

    await this.repository.startSession({
      sessionId,
      deviceId: normalizedId,
      userId: owner,
      tokenHash: hashDeviceSecret(secret),
      startedAt,
      expiresAt,
      endedAt: null,
      endReason: null,
    });

    this.logger.info(
      { event: PHONE_EVENTS.PHONE_SESSION_STARTED },
      `Phone session ${sessionId} started for ${normalizedId}`,
    );

    return {
      session_id: sessionId,
      device_id: normalizedId,
      upload_token: `${sessionId}.${secret}`,
      duration_ms: durationMs,
      started_at: startedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    };
  }

  // *** END A PHONE UPLOAD SESSION - MOBILE ***
  async endSession(userId: string | undefined, deviceId: string, sessionId: string): Promise<void> {
    const owner = requireUserId(userId);
    const normalizedId = DeviceId.create(deviceId).toString();

    await this.repository.endSession(owner, normalizedId, sessionId, 'stopped');

    this.logger.info(
      { event: PHONE_EVENTS.PHONE_SESSION_ENDED },
      `Phone session ${sessionId} ended for ${normalizedId}`,
    );
  }

  // *** VERIFY AN UPLOAD TOKEN - SERVICE (model-api) ***
  // Every failure gives the same 401 so the response does not reveal which
  // check failed.
  async verifyUploadToken(token: string): Promise<VerifiedPhoneUpload> {
    const [sessionId, secret, ...rest] = (token ?? '').trim().split('.');
    if (!sessionId || !secret || rest.length > 0) {
      throw new UnauthorizedException(INVALID_UPLOAD_TOKEN);
    }

    const session = await this.repository.findSession(sessionId);
    if (!session || !/^[a-f0-9]{64}$/.test(session.tokenHash)) {
      throw new UnauthorizedException(INVALID_UPLOAD_TOKEN);
    }

    const supplied = Buffer.from(hashDeviceSecret(secret), 'hex');
    if (!timingSafeEqual(supplied, Buffer.from(session.tokenHash, 'hex'))) {
      throw new UnauthorizedException(INVALID_UPLOAD_TOKEN);
    }

    if (session.endedAt || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException(INVALID_UPLOAD_TOKEN);
    }

    // The camera must still belong to the user who started the session and
    // must still point at this session. This covers account changes and
    // superseded sessions.
    const device = await this.repository.findDevice(session.deviceId);
    if (
      !device ||
      !device.isPhone() ||
      device.getAssignedUserId() !== session.userId ||
      device.getActiveSessionId() !== session.sessionId
    ) {
      throw new UnauthorizedException(INVALID_UPLOAD_TOKEN);
    }

    return {
      device_id: session.deviceId,
      session_id: session.sessionId,
      expires_at: session.expiresAt.toISOString(),
    };
  }

  // *** REPORT STREAM PRESENCE - SERVICE (model-api) ***
  // A 401 tells model-api the session was ended or replaced, so it closes the
  // stream.
  async reportPresence(sessionId: string, connected: boolean): Promise<void> {
    const session = await this.repository.findSession(sessionId);
    if (!session) {
      throw new UnauthorizedException(INVALID_UPLOAD_TOKEN);
    }

    const stillActive =
      !session.endedAt &&
      (session.expiresAt.getTime() > Date.now() || !connected) &&
      (await this.repository.updatePresence(session.deviceId, sessionId, connected));

    if (!stillActive && connected) {
      throw new UnauthorizedException(INVALID_UPLOAD_TOKEN);
    }
  }
}
