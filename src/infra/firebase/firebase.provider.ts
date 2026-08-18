import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp } from 'firebase-admin';
import type { EnvironmentVariables } from '../../config/env.validation';
import { FIREBASE_APP } from './firebase.constants';

export const FirebaseProvider = {
  provide: FIREBASE_APP,
  inject: [ConfigService],

  useFactory: (configService: ConfigService<EnvironmentVariables, true>) => {
    if (getApps().length > 0) {
      return getApps()[0];
    }
    return initializeApp({
      credential: cert({
        projectId: configService.get('FIREBASE_PROJECT_ID', { infer: true }),
        clientEmail: configService.get('FIREBASE_CLIENT_EMAIL', { infer: true }),
        privateKey: configService
          .get('FIREBASE_PRIVATE_KEY', { infer: true })
          .replace(/\\n/g, '\n'),
      }),
    });
  },
};
