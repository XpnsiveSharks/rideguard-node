import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';

const HEALTH_COLLECTION = '_health';
const HEALTH_DOC_ID = 'connectivity-check';

type HealthResult = {
  ok: true;
};

@Injectable()
export class HealthService {
  constructor(@Inject(FIREBASE_FIRESTORE) private readonly firestore: Firestore) {}

  // FIRESTORE CONNECTIVITY CHECK
  async checkFirestore(): Promise<HealthResult> {
    const ref = this.firestore.collection(HEALTH_COLLECTION).doc(HEALTH_DOC_ID);

    try {
      await ref.set({ checkedAt: Timestamp.now() });
      const snapshot = await ref.get();

      if (!snapshot.exists) {
        throw new Error('Wrote to Firestore but the document was not there on read-back');
      }

      return { ok: true };
    } catch (error) {
      throw new InternalServerErrorException(
        `Firestore connectivity check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
