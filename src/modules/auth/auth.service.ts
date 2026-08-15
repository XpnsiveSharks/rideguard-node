import { Inject, Injectable } from '@nestjs/common';
import { Auth, DecodedIdToken } from 'firebase-admin/auth';
import { FIREBASE_AUTH } from '../../infra/firebase/firebase.constants';

@Injectable()
export class AuthService {
  constructor(@Inject(FIREBASE_AUTH) private readonly auth: Auth) {}

  /**
   * Verifies a Firebase ID token. Pass checkRevoked to also reject tokens
   * belonging to signed-out or disabled accounts (costs one lookup per call).
   */
  verifyToken(token: string, checkRevoked = false): Promise<DecodedIdToken> {
    return this.auth.verifyIdToken(token, checkRevoked);
  }
}
