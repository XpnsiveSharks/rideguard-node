import { Injectable, Inject } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import { Profile } from '../domain/profile.entity';
import { EmergencyContact } from '../domain/emergency-contact.value-object';
import { FieldValue } from 'firebase-admin/firestore';
import { ProfileMapper } from './profile.mapper';
import { EmergencyContactMapper } from './emergency-contact.mapper';
import { PROFILES_COLLECTION } from './profile.document';

@Injectable()
export class ProfileRepository {
  constructor(@Inject(FIREBASE_FIRESTORE) private readonly firestoreClient: Firestore) {}

  async saveProfile(profile: Profile): Promise<void> {
    await this.firestoreClient
      .collection(PROFILES_COLLECTION)
      .doc(profile.getUid())
      .create({
        ...ProfileMapper.toPersistence(profile),
        createdAt: FieldValue.serverTimestamp(),
      });
  }

  async saveContactInfo(uid: string, emergencyContact: EmergencyContact): Promise<void> {
    await this.firestoreClient
      .collection(PROFILES_COLLECTION)
      .doc(uid)
      .set(
        {
          ...EmergencyContactMapper.toPersistence(emergencyContact),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  }

  async findProfileByUid(uid: string): Promise<boolean> {
    const docRef = this.firestoreClient.collection(PROFILES_COLLECTION).doc(uid);
    const docSnapshot = await docRef.get();
    return !docSnapshot.exists ? false : true;
  }
}
