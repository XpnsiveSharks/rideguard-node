import { Injectable, Inject } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import { Device } from '../domain/device.entity';
import { DeviceMapper } from './devices.mapper';

const DEVICES_COLLECTION = 'devices';

@Injectable()
export class DeviceRepository {
  constructor(@Inject(FIREBASE_FIRESTORE) private readonly firestoreClient: Firestore) {}

  async saveDevice(device: Device): Promise<void> {
    await this.firestoreClient
      .collection(DEVICES_COLLECTION)
      .doc()
      .create(DeviceMapper.toPersistence(device));
  }
}
