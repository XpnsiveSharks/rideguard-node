import { Injectable, Inject } from '@nestjs/common';
import { FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import { Firestore } from 'firebase-admin/firestore';
import { Alert } from '../domain/alerts.entity';
import { ALERTS_COLLECTION, AlertsMapper } from './alerts.mapper';

@Injectable()
export class AlertsRepository {
  constructor(@Inject(FIREBASE_FIRESTORE) private readonly firestoreClient: Firestore) {}

  async save(alert: Alert): Promise<Alert> {
    await this.firestoreClient.collection(ALERTS_COLLECTION).add(AlertsMapper.toPersistence(alert));
    return alert;
  }
}
