import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { Rest } from 'ably';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { ABLY_REST } from '@/infra/ably/ably.constants';
import { FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';

const HEALTH_COLLECTION = '_health';
const HEALTH_DOC_ID = 'connectivity-check';

type HealthResult = {
  ok: true;
};

@Injectable()
export class HealthService {
  constructor(
    @Inject(FIREBASE_FIRESTORE) private readonly firestore: Firestore,
    @Inject(ABLY_REST) private readonly ably: Rest,
  ) {}

  // ***FIRESTORE CONNECTIVITY CHECK***
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

  // ***ABLY CONNECTIVITY CHECK***
  async checkAbly(): Promise<HealthResult> {
    try {
      await this.ably.auth.requestToken();

      return { ok: true };
    } catch (error) {
      throw new InternalServerErrorException(
        `Ably connectivity check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
