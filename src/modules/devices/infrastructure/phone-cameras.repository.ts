import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { FieldValue, Firestore, Timestamp } from 'firebase-admin/firestore';
import { FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import { Device, DeviceFields } from '../domain/device.entity';
import { DeviceMapper, DEVICES_COLLECTION } from './devices.mapper';
import { MAX_DEVICE_ID_GENERATION_ATTEMPTS } from '../device.constants';

export const PHONE_INSTALLATIONS_COLLECTION = 'phone-installations';
export const PHONE_SESSIONS_COLLECTION = 'phone-sessions';

export interface PhoneSessionRecord {
  sessionId: string;
  deviceId: string;
  userId: string;
  tokenHash: string;
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
  endReason: string | null;
}

interface PhoneSessionDocument extends Omit<
  PhoneSessionRecord,
  'startedAt' | 'expiresAt' | 'endedAt'
> {
  startedAt: Timestamp | Date;
  expiresAt: Timestamp | Date;
  endedAt: Timestamp | Date | null;
}

function toDate(value: Timestamp | Date): Date {
  return value instanceof Timestamp ? value.toDate() : value;
}

function toSessionRecord(document: PhoneSessionDocument): PhoneSessionRecord {
  return {
    ...document,
    startedAt: toDate(document.startedAt),
    expiresAt: toDate(document.expiresAt),
    endedAt: document.endedAt ? toDate(document.endedAt) : null,
    endReason: document.endReason ?? null,
  };
}

// One mapping document per (user, installation). The key is hashed so the raw
// installation ID is not used as a document path.
function installationKey(userId: string, installationId: string): string {
  return createHash('sha256').update(`${userId}:${installationId}`, 'utf8').digest('hex');
}

function assertOwnedPhone(device: Device | null, userId: string): Device {
  if (!device || !device.isPhone()) {
    throw new NotFoundException('Phone camera not found');
  }
  if (device.getAssignedUserId() !== userId) {
    throw new ForbiddenException('This phone camera belongs to another account');
  }
  return device;
}

@Injectable()
export class PhoneCameraRepository {
  constructor(@Inject(FIREBASE_FIRESTORE) private readonly firestore: Firestore) {}

  // Returns this installation's phone camera, creating it on first call. Runs
  // in a transaction so concurrent retries cannot create two cameras.
  async findOrCreate(
    userId: string,
    installationId: string,
  ): Promise<{ device: Device; created: boolean }> {
    const mappingRef = this.firestore
      .collection(PHONE_INSTALLATIONS_COLLECTION)
      .doc(installationKey(userId, installationId));

    return this.firestore.runTransaction(async (transaction) => {
      const mapping = await transaction.get(mappingRef);
      const mappedId = mapping.exists ? (mapping.get('deviceId') as string | undefined) : undefined;

      if (mappedId) {
        const existing = await transaction.get(
          this.firestore.collection(DEVICES_COLLECTION).doc(mappedId),
        );
        if (existing.exists) {
          const device = DeviceMapper.toDomain(existing.data() as DeviceFields);
          return { device: assertOwnedPhone(device, userId), created: false };
        }
      }

      for (let attempt = 1; attempt <= MAX_DEVICE_ID_GENERATION_ATTEMPTS; attempt++) {
        const device = Device.createPhoneCamera(userId, installationId);
        const deviceRef = this.firestore.collection(DEVICES_COLLECTION).doc(device.getDeviceId());
        const taken = await transaction.get(deviceRef);
        if (taken.exists) {
          continue;
        }

        transaction.create(deviceRef, {
          ...DeviceMapper.toPersistence(device),
          createdAt: FieldValue.serverTimestamp(),
        });
        transaction.set(mappingRef, {
          deviceId: device.getDeviceId(),
          userId,
          installationId,
          createdAt: FieldValue.serverTimestamp(),
        });
        return { device, created: true };
      }

      throw new ConflictException('Could not generate a unique device ID. Please try again.');
    });
  }

  // Starts a new upload session. Any earlier session for the same camera is
  // ended, so only the newest token can upload.
  async startSession(session: PhoneSessionRecord): Promise<void> {
    const deviceRef = this.firestore.collection(DEVICES_COLLECTION).doc(session.deviceId);
    const sessionRef = this.firestore.collection(PHONE_SESSIONS_COLLECTION).doc(session.sessionId);

    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(deviceRef);
      const device = assertOwnedPhone(
        snapshot.exists ? DeviceMapper.toDomain(snapshot.data() as DeviceFields) : null,
        session.userId,
      );

      const previousId = device.getActiveSessionId();
      if (previousId) {
        transaction.set(
          this.firestore.collection(PHONE_SESSIONS_COLLECTION).doc(previousId),
          { endedAt: FieldValue.serverTimestamp(), endReason: 'superseded' },
          { merge: true },
        );
      }

      transaction.create(sessionRef, session);
      transaction.update(deviceRef, {
        activeSessionId: session.sessionId,
        sessionExpiresAt: session.expiresAt,
        connected: false,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  }

  // Idempotent. Ending an already-ended or superseded session is not an error.
  async endSession(
    userId: string,
    deviceId: string,
    sessionId: string,
    reason: string,
  ): Promise<void> {
    const deviceRef = this.firestore.collection(DEVICES_COLLECTION).doc(deviceId);
    const sessionRef = this.firestore.collection(PHONE_SESSIONS_COLLECTION).doc(sessionId);

    await this.firestore.runTransaction(async (transaction) => {
      const [deviceSnapshot, sessionSnapshot] = await Promise.all([
        transaction.get(deviceRef),
        transaction.get(sessionRef),
      ]);
      const device = assertOwnedPhone(
        deviceSnapshot.exists ? DeviceMapper.toDomain(deviceSnapshot.data() as DeviceFields) : null,
        userId,
      );

      if (!sessionSnapshot.exists || sessionSnapshot.get('deviceId') !== deviceId) {
        throw new NotFoundException('Phone session not found');
      }

      if (!sessionSnapshot.get('endedAt')) {
        transaction.update(sessionRef, {
          endedAt: FieldValue.serverTimestamp(),
          endReason: reason,
        });
      }

      if (device.getActiveSessionId() === sessionId) {
        transaction.update(deviceRef, {
          activeSessionId: null,
          sessionExpiresAt: null,
          connected: false,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });
  }

  async findSession(sessionId: string): Promise<PhoneSessionRecord | null> {
    const snapshot = await this.firestore
      .collection(PHONE_SESSIONS_COLLECTION)
      .doc(sessionId)
      .get();
    return snapshot.exists ? toSessionRecord(snapshot.data() as PhoneSessionDocument) : null;
  }

  async findDevice(deviceId: string): Promise<Device | null> {
    const snapshot = await this.firestore.collection(DEVICES_COLLECTION).doc(deviceId).get();
    return snapshot.exists ? DeviceMapper.toDomain(snapshot.data() as DeviceFields) : null;
  }

  // Records model-api presence. Returns false when the session is no longer
  // the camera's active one, so the caller can close the stream.
  async updatePresence(deviceId: string, sessionId: string, connected: boolean): Promise<boolean> {
    const deviceRef = this.firestore.collection(DEVICES_COLLECTION).doc(deviceId);

    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(deviceRef);
      if (!snapshot.exists || snapshot.get('activeSessionId') !== sessionId) {
        return false;
      }

      transaction.update(deviceRef, {
        connected,
        lastSeenAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
  }
}
