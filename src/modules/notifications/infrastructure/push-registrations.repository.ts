import { Inject, Injectable } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import { PushRegistration } from '../domain/push-registration.entity';
import { NotificationMapper, PUSH_REGISTRATION_COLLECTION } from './notification.mapper';

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
}
