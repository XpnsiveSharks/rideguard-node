import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import { Device, DeviceFields } from '../domain/device.entity';
import { DeviceMapper, DEVICES_COLLECTION } from './devices.mapper';
import { FieldValue } from 'firebase-admin/firestore';

@Injectable()
export class DeviceRepository {
  constructor(@Inject(FIREBASE_FIRESTORE) private readonly firestore: Firestore) {}

  async saveDevice(device: Device): Promise<void> {
    await this.firestore
      .collection(DEVICES_COLLECTION)
      .doc(device.getDeviceId())
      .create({ ...DeviceMapper.toPersistence(device), createdAt: FieldValue.serverTimestamp() });
  }

  async assignToUser(deviceId: string, userId: string): Promise<Device> {
    const reference = this.firestore.collection(DEVICES_COLLECTION).doc(deviceId);

    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);

      if (!snapshot.exists) {
        throw new NotFoundException('Device not found');
      }

      const device = DeviceMapper.toDomain(snapshot.data() as DeviceFields);

      const updatedDevice = device.assignToUser(userId);

      transaction.update(reference, {
        assignedUserId: updatedDevice.getAssignedUserId(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return updatedDevice;
    });
  }

  async findDeviceById(deviceId: string): Promise<Device | null> {
    const deviceDoc = await this.firestore.collection(DEVICES_COLLECTION).doc(deviceId).get();
    if (!deviceDoc.exists) {
      return null;
    }
    return DeviceMapper.toDomain(deviceDoc.data() as DeviceFields);
  }

  async findAssignedUserIdByDeviceId(deviceId: string): Promise<string | null> {
    const deviceDoc = await this.firestore.collection(DEVICES_COLLECTION).doc(deviceId).get();

    if (!deviceDoc.exists) {
      return null;
    }

    const device = deviceDoc.data() as DeviceFields;

    return device.assignedUserId ?? null;
  }

  async findDeviceIdsByAssignedUser(assignedUserId: string): Promise<string[]> {
    const querySnapshot = await this.firestore
      .collection(DEVICES_COLLECTION)
      .where('assignedUserId', '==', assignedUserId)
      .get();

    return querySnapshot.docs.map((doc) => doc.id);
  }
}
