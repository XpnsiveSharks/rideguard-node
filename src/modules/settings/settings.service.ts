import { Inject, Injectable } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import { PROFILES_COLLECTION } from '@/modules/profile/infrastructure/profile.document';
import { AutoArchiveHours, AutoArchiveResponse } from './settings.dto';

interface CachedPreference {
  autoArchiveHours: AutoArchiveHours;
  cachedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class SettingsService {
  private readonly preferenceCache = new Map<string, CachedPreference>();

  constructor(
    @Inject(FIREBASE_FIRESTORE)
    private readonly firestore: Firestore,
  ) {}

  async getAutoArchive(uid: string): Promise<AutoArchiveResponse> {
    const cached = this.preferenceCache.get(uid);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return { autoArchiveHours: cached.autoArchiveHours };
    }

    const doc = await this.firestore.collection(PROFILES_COLLECTION).doc(uid).get();
    const data = doc.data();
    const hours = (data?.autoArchiveHours as AutoArchiveHours) ?? null;

    this.preferenceCache.set(uid, {
      autoArchiveHours: hours,
      cachedAt: Date.now(),
    });

    return { autoArchiveHours: hours };
  }

  async updateAutoArchive(uid: string, autoArchiveHours: AutoArchiveHours): Promise<AutoArchiveResponse> {
    const profileRef = this.firestore.collection(PROFILES_COLLECTION).doc(uid);

    await profileRef.set(
      {
        autoArchiveHours,
      },
      { merge: true },
    );

    this.preferenceCache.set(uid, {
      autoArchiveHours,
      cachedAt: Date.now(),
    });

    return { autoArchiveHours };
  }

  // Returns all profiles that have auto-archive enabled (non-null) for background processing
  async getEnabledProfiles(): Promise<Array<{ uid: string; autoArchiveHours: 24 | 48 | 72 }>> {
    const snapshot = await this.firestore
      .collection(PROFILES_COLLECTION)
      .where('autoArchiveHours', 'in', [24, 48, 72])
      .get();

    return snapshot.docs.map((doc) => ({
      uid: doc.id,
      autoArchiveHours: doc.data().autoArchiveHours as 24 | 48 | 72,
    }));
  }

  clearCache(uid?: string): void {
    if (uid) {
      this.preferenceCache.delete(uid);
    } else {
      this.preferenceCache.clear();
    }
  }
}
