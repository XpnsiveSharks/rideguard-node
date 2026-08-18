import { cert, getApps, initializeApp } from 'firebase-admin';
import { FIREBASE_APP } from './firebase.constants';

export const FirebaseProvider = {
  provide: FIREBASE_APP,

  useFactory: () => {
    if (getApps().length > 0) {
      return getApps()[0];
    }
    return initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  },
};
