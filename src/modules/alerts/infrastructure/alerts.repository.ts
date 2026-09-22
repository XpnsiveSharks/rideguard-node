import { BadRequestException, Injectable, Inject, NotFoundException } from '@nestjs/common';
import { FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import { FieldPath, Firestore } from 'firebase-admin/firestore';
import { Alert, AlertFields } from '../domain/alerts.entity';
import { ALERTS_COLLECTION, AlertsMapper } from './alerts.mapper';

@Injectable()
export class AlertsRepository {
  constructor(@Inject(FIREBASE_FIRESTORE) private readonly firestoreClient: Firestore) {}

  async save(alert: Alert): Promise<void> {
    await this.firestoreClient.collection(ALERTS_COLLECTION).add(AlertsMapper.toPersistence(alert));
  }

  async findNonFalseAlarmsByDeviceId(
    deviceIds: string[],
    limit: number,
    cursor?: string,
  ): Promise<{ data: Alert[]; nextCursor: string | null }> {
    if (deviceIds.length === 0) {
      return { data: [], nextCursor: null };
    }

    const alertsCollection = this.firestoreClient.collection(ALERTS_COLLECTION);
    let query = alertsCollection
      .where('deviceId', 'in', deviceIds)
      .where('isFalseAlarm', '==', false)
      .orderBy('timeStamp', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');

    if (cursor) {
      const cursorDocument = await alertsCollection.doc(cursor).get();
      const cursorData = cursorDocument.data() as AlertFields | undefined;

      if (
        !cursorDocument.exists ||
        !cursorData ||
        cursorData.isFalseAlarm !== false ||
        !deviceIds.includes(cursorData.deviceId)
      ) {
        throw new BadRequestException('The alert cursor is invalid.');
      }

      query = query.startAfter(cursorDocument);
    }

    const querySnapshot = await query.limit(limit + 1).get();
    const hasMore = querySnapshot.docs.length > limit;
    const pageDocuments = querySnapshot.docs.slice(0, limit);

    return {
      data: pageDocuments.map((doc) => AlertsMapper.toDomain(doc.id, doc.data() as AlertFields)),
      nextCursor: hasMore ? (pageDocuments.at(-1)?.id ?? null) : null,
    };
  }

  async updateIsSeen(alertId: string, deviceIds: string[], isSeen: boolean): Promise<void> {
    const alertDocument = this.firestoreClient.collection(ALERTS_COLLECTION).doc(alertId);
    const alertSnapshot = await alertDocument.get();
    const alertData = alertSnapshot.data() as AlertFields | undefined;

    if (!alertSnapshot.exists || !alertData || !deviceIds.includes(alertData.deviceId)) {
      throw new NotFoundException('Alert not found.');
    }

    await alertDocument.update({ isSeen });
  }

  async updateIsFalseAlarm(
    alertId: string,
    deviceIds: string[],
    isFalseAlarm: boolean,
  ): Promise<void> {
    const alertDocument = this.firestoreClient.collection(ALERTS_COLLECTION).doc(alertId);
    const alertSnapshot = await alertDocument.get();
    const alertData = alertSnapshot.data() as AlertFields | undefined;

    if (!alertSnapshot.exists || !alertData || !deviceIds.includes(alertData.deviceId)) {
      throw new NotFoundException('Alert not found.');
    }

    await alertDocument.update({ isFalseAlarm });
  }
}
