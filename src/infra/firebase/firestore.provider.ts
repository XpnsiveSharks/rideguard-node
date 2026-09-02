import { App } from 'firebase-admin/app';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import { FIREBASE_APP, FIREBASE_FIRESTORE } from './firebase.constants';

export const FirestoreProvider = {
  provide: FIREBASE_FIRESTORE,
  inject: [FIREBASE_APP],

  /* getFirestore() only creates the client and doesn't make a network request.
   * But invalid config like a wrong project ID or bad credentials can still fail here.
   * We wrap it so the error is easier to understand.
   */
  useFactory: (app: App): Firestore => {
    try {
      const firestore = getFirestore(app);
      firestore.settings({ ignoreUndefinedProperties: true });

      return firestore;
    } catch (error) {
      throw new Error(
        `Failed to initialize Firestore: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
};
