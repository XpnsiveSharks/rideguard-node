import { App } from 'firebase-admin/app';
import { getMessaging, Messaging } from 'firebase-admin/messaging';
import { FIREBASE_APP, FIREBASE_MESSAGING } from './firebase.constants';

// Exposes the Firebase Cloud Messaging (FCM) client, built from the shared
// Firebase app so the whole process uses one initialized SDK instance.
export const MessagingProvider = {
  provide: FIREBASE_MESSAGING,
  inject: [FIREBASE_APP],

  useFactory: (app: App): Messaging => {
    try {
      return getMessaging(app);
    } catch (error) {
      throw new Error(
        `Failed to initialize Firebase Messaging: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
};
