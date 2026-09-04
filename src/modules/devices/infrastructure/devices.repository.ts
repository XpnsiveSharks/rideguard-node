import { Injectable, Inject } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import { Device } from '../domain/device.entity';
import { DeviceMapper } from './devices.mapper';
import { FieldValue } from 'firebase-admin/firestore';
import { DeviceDocument, DEVICES_COLLECTION } from './devices.document';
import { DeviceId } from '../domain/device-id.value-object';

@Injectable()
export class DeviceRepository {
  constructor(@Inject(FIREBASE_FIRESTORE) private readonly firestoreClient: Firestore) {}

  async saveDevice(device: Device): Promise<void> {
    await this.firestoreClient
      .collection(DEVICES_COLLECTION)
      .doc(device.getDeviceId())
      .create({ ...DeviceMapper.toPersistence(device), createdAt: FieldValue.serverTimestamp() });
  }

  async updateDevice(deviceId: DeviceId, UpdateQuery: Partial<Device>): Promise<Device> {
    await this.firestoreClient
      .collection(DEVICES_COLLECTION)
      .doc(deviceId.toString())
      .set({ ...UpdateQuery, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    const deviceDoc = await this.firestoreClient
      .collection(DEVICES_COLLECTION)
      .doc(deviceId.toString())
      .get();
    return DeviceMapper.toDomain(deviceDoc.data() as DeviceDocument);
  }

  async findDeviceById(deviceId: DeviceId): Promise<Device | null> {
    const deviceDoc = await this.firestoreClient
      .collection(DEVICES_COLLECTION)
      .doc(deviceId.toString())
      .get();
    if (!deviceDoc.exists) {
      return null;
    }
    return DeviceMapper.toDomain(deviceDoc.data() as DeviceDocument);
  }
}
