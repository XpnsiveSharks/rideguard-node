import { Injectable, Inject, NotFoundException } from '@nestjs/common';
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

  async updateProfile(profile: Profile): Promise<void> {
    await this.firestoreClient
      .collection(PROFILES_COLLECTION)
      .doc(profile.getUid())
      .set(
        {
          ...ProfileMapper.toPersistence(profile),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
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
    return docSnapshot.exists && typeof docSnapshot.data()?.personalInfo === 'object';
  }

  async getProfile(uid: string): Promise<Record<string, unknown> | null> {
    const snapshot = await this.firestoreClient.collection(PROFILES_COLLECTION).doc(uid).get();
    return snapshot.exists ? (snapshot.data() as Record<string, unknown>) : null;
  }

  async updateEditableProfile(
    uid: string,
    input: Partial<{
      firstName: string;
      lastName: string;
      phoneNumber: string;
      brand: string;
      model: string;
      plateNumber: string;
      color: string;
    }>,
  ): Promise<Record<string, unknown>> {
    const ref = this.firestoreClient.collection(PROFILES_COLLECTION).doc(uid);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new NotFoundException('Profile does not exist');
    }
    const profile = snapshot.data() as Record<string, unknown>;
    const personalInfo = (profile.personalInfo ?? {}) as Record<string, unknown>;
    const vehicle = (profile.vehicle ?? {}) as Record<string, unknown>;
    const nextPersonalInfo = {
      ...personalInfo,
      ...(input.firstName !== undefined && { firstName: input.firstName }),
      ...(input.lastName !== undefined && { lastName: input.lastName }),
      ...(input.phoneNumber !== undefined && { phoneNumber: input.phoneNumber }),
    };
    const nextVehicle = {
      ...vehicle,
      ...(input.brand !== undefined && { brand: input.brand }),
      ...(input.model !== undefined && { model: input.model }),
      ...(input.plateNumber !== undefined && { plateNumber: input.plateNumber }),
      ...(input.color !== undefined && { color: input.color }),
    };
    await ref.set(
      { personalInfo: nextPersonalInfo, vehicle: nextVehicle, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return { ...profile, personalInfo: nextPersonalInfo, vehicle: nextVehicle };
  }

  async updateProfilePhoto(
    uid: string,
    photo: { photo_url: string; public_id: string },
  ): Promise<void> {
    await this.firestoreClient
      .collection(PROFILES_COLLECTION)
      .doc(uid)
      .set({ ...photo, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
}
