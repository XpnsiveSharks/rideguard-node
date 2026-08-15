import { DecodedIdToken } from 'firebase-admin/auth';

declare global {
  namespace Express {
    interface Request {
      /** Set by FirebaseAuthGuard once the bearer token is verified. */
      user?: DecodedIdToken;
    }
  }
}
