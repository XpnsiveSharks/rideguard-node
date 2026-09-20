import { Injectable, Inject } from '@nestjs/common';
import { FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import { Firestore } from 'firebase-admin/firestore';
import { Alert, AlertFields } from '../domain/alerts.entity';
import { ALERTS_COLLECTION, AlertsMapper } from './alerts.mapper';

@Injectable()
export class AlertsRepository {
  constructor(@Inject(FIREBASE_FIRESTORE) private readonly firestoreClient: Firestore) {}

  async save(alert: Alert): Promise<void> {
    await this.firestoreClient.collection(ALERTS_COLLECTION).add(AlertsMapper.toPersistence(alert));
  }

  async findNonFalseAlarmsByDeviceId(deviceIds: string[]): Promise<Alert[]> {
    if (deviceIds.length === 0) {
      return [];
    }
    const querySnapshot = await this.firestoreClient
      .collection(ALERTS_COLLECTION)
      .where('deviceId', 'in', deviceIds)
      .where('isFalseAlarm', '==', false)
      .get();

    return querySnapshot.docs.map((doc) =>
      AlertsMapper.toDomain(doc.id, doc.data() as AlertFields),
    );
  }
}
