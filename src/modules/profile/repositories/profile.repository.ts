import { Injectable, Inject } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { ALREADY_EXISTS_ERROR_CODE, FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import { Profile } from '../domain/profile.entity';
import { ConflictException } from '@nestjs/common';
import { EmergencyContact } from '../domain/emergency-contact.value-object';

const PROFILES_COLLECTION = 'profiles';

@Injectable()
export class ProfileRepository {
  constructor(@Inject(FIREBASE_FIRESTORE) private readonly firestoreClient: Firestore) {}

  async saveProfile(profile: Profile): Promise<void> {
    await this.firestoreClient
      .collection(PROFILES_COLLECTION)
      .doc(profile.getUid())
      .create({
        ...profile.getPersonalInfo(),
        ...profile.getVehicle(),
        ...profile.getEmergencyContact(),
      });
  }

  async saveContactInfo(uid: string, emergencyContact: EmergencyContact): Promise<void> {
    console.table(emergencyContact.emergencyContactInfo);
    await this.firestoreClient
      .collection(PROFILES_COLLECTION)
      .doc(uid)
      .set({ ...emergencyContact }, { merge: true });
  }

  async findProfileByUid(uid: string): Promise<boolean> {
    const docRef = this.firestoreClient.collection(PROFILES_COLLECTION).doc(uid);
    const docSnapshot = await docRef.get();
    return !docSnapshot.exists ? false : true;
  }
}
