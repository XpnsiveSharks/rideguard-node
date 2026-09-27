import { Inject, Injectable } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import { PushRegistration, PushRegistrationFields } from '../domain/push-registration.entity';
import { NotificationMapper, PUSH_REGISTRATION_COLLECTION } from './notification.mapper';
import type { DeleteRegistrationResult } from '../notifications.types';

@Injectable()
export class PushRegistrationsRepository {
  constructor(
    @Inject(FIREBASE_FIRESTORE)
    private readonly firestore: Firestore,
  ) {}

  async save(registration: PushRegistration): Promise<void> {
    const persistenceData = NotificationMapper.toPersistence(registration);
    await this.firestore
      .collection(PUSH_REGISTRATION_COLLECTION)
      .doc(persistenceData.installationId)
      .set(persistenceData);
  }

  async deleteOwnedRegistration(
    installationId: string,
    userId: string,
  ): Promise<DeleteRegistrationResult> {
    const reference = this.firestore.collection(PUSH_REGISTRATION_COLLECTION).doc(installationId);

    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);

      if (!snapshot.exists) {
        return 'missing';
      }

      const ownerId = (snapshot.data() as PushRegistrationFields).userId;

      if (ownerId !== userId) {
        return 'not-owned';
      }

      transaction.delete(reference);
      return 'deleted';
    });
  }
}
