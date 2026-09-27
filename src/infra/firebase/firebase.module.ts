import { Module } from '@nestjs/common';
import { App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import {
  FIREBASE_APP,
  FIREBASE_AUTH,
  FIREBASE_FIRESTORE,
  FIREBASE_MESSAGING,
} from './firebase.constants';
import { FirebaseProvider } from './firebase.provider';
import { FirestoreProvider } from './firestore.provider';
import { MessagingProvider } from './messaging.provider';
import { Global } from '@nestjs/common';
@Global()
@Module({
  providers: [
    FirebaseProvider,
    FirestoreProvider,
    MessagingProvider,
    {
      provide: FIREBASE_AUTH,
      inject: [FIREBASE_APP],
      useFactory: (app: App) => getAuth(app),
    },
  ],
  exports: [FIREBASE_APP, FIREBASE_AUTH, FIREBASE_FIRESTORE, FIREBASE_MESSAGING],
})
export class FirebaseModule {}
