import { Module } from '@nestjs/common';
import { App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FIREBASE_APP, FIREBASE_AUTH } from './firebase.constants';
import { FirebaseProvider } from './firebase.provider';

@Module({
  providers: [
    FirebaseProvider,
    {
      provide: FIREBASE_AUTH,
      inject: [FIREBASE_APP],
      useFactory: (app: App) => getAuth(app),
    },
  ],
  exports: [FIREBASE_APP, FIREBASE_AUTH],
})
export class FirebaseModule {}
