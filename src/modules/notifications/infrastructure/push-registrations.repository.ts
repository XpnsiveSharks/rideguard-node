import { Inject, Injectable } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import { PushRegistration, PushRegistrationFields } from '../domain/push-registration.entity';
import { NotificationMapper, PUSH_REGISTRATION_COLLECTION } from './notification.mapper';
import type { DeleteRegistrationResult } from '../notifications.types';
import { FIRESTORE_IN_QUERY_LIMIT } from '../notifications.constants';

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

  // Loads every push registration belonging to any of the given users. Callers
  // decide who to notify and how; this method only fetches the raw registrations.
  async findByUserIds(userIds: readonly string[]): Promise<PushRegistration[]> {
    // Drop duplicates so we don't query for or return the same user twice.
    const uniqueUserIds = [...new Set(userIds)];

    if (uniqueUserIds.length === 0) {
      return [];
    }

    const collection = this.firestore.collection(PUSH_REGISTRATION_COLLECTION);

    // Firestore's `in` operator caps the list length, so we split the user IDs
    // into chunks and run one query per chunk.
    const chunks = this.chunkUserIds(uniqueUserIds);
    const snapshots = await Promise.all(
      chunks.map((chunk) => collection.where('userId', 'in', chunk).get()),
    );

    return snapshots.flatMap((snapshot) =>
      snapshot.docs.map((doc) => NotificationMapper.toDomain(doc.data() as PushRegistrationFields)),
    );
  }

  // Break a list of user IDs into groups that each fit Firestore's `in` limit.
  private chunkUserIds(userIds: string[]): string[][] {
    const chunks: string[][] = [];
    for (let index = 0; index < userIds.length; index += FIRESTORE_IN_QUERY_LIMIT) {
      chunks.push(userIds.slice(index, index + FIRESTORE_IN_QUERY_LIMIT));
    }
    return chunks;
  }

  // Deletes a registration only if its stored token still matches `registrationId`.
  // FCM told us this token is invalid, but between the send and now the device
  // may have refreshed its token (stored value differs). In that case we keep the
  // registration so a now-valid token is not thrown away. The read-then-write runs
  // in a transaction so a concurrent refresh cannot slip past the check.
  // Returns true only when a document was actually deleted.
  async deleteIfTokenMatches(installationId: string, registrationId: string): Promise<boolean> {
    const reference = this.firestore.collection(PUSH_REGISTRATION_COLLECTION).doc(installationId);

    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);

      if (!snapshot.exists) {
        return false;
      }

      const storedRegistrationId = (snapshot.data() as PushRegistrationFields).registrationId;

      if (storedRegistrationId !== registrationId) {
        return false;
      }

      transaction.delete(reference);
      return true;
    });
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
