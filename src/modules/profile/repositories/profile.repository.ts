import { Injectable, Inject } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { ALREADY_EXISTS_ERROR_CODE, FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import { Profile } from '../domain/profile.entity';
import { ConflictException } from '@nestjs/common';

const PROFILES_COLLECTION = 'profiles';

@Injectable()
export class ProfileRepository {
  constructor(@Inject(FIREBASE_FIRESTORE) private readonly firestoreClient: Firestore) {}

  async savePersonalInfo(profile: Profile): Promise<void> {
    try {
      await this.firestoreClient
        .collection(PROFILES_COLLECTION)
        .doc(profile.getUid())
        .create({
          ...profile.getPersonalInfo().info,
        });
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === ALREADY_EXISTS_ERROR_CODE) {
        throw new ConflictException('Profile with this email already exists.');
      }
    }
  }
}
