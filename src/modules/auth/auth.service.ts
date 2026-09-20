import { Inject, Injectable } from '@nestjs/common';
import { Auth, DecodedIdToken } from 'firebase-admin/auth';
import { FIREBASE_AUTH } from '@/infra/firebase/firebase.constants';
import { ABLY_REST } from '@/infra/ably/ably.constants';
import { Rest, TokenRequest } from 'ably';
import { REALTIME_CHANNELS } from '@/modules/realtime/realtime.constants';
import { ONE_HOUR_IN_MILLISECONDS } from '@/common/constants/time.constants';
@Injectable()
export class AuthService {
  constructor(
    @Inject(FIREBASE_AUTH) private readonly auth: Auth,
    @Inject(ABLY_REST) private readonly ably: Rest,
  ) {}

  // *** VERIFY FIREBASE ID TOKEN ***
  verifyToken(token: string, checkRevoked = false): Promise<DecodedIdToken> {
    return this.auth.verifyIdToken(token, checkRevoked);
  }

  // *** CREATE ABLY TOKEN REQUEST FOR USER ***
  createAblyTokenRequest(userId: string): Promise<TokenRequest> {
    const userChannelPattern = REALTIME_CHANNELS.alertsForUser(userId);

    return this.ably.auth.createTokenRequest({
      clientId: userId,
      ttl: ONE_HOUR_IN_MILLISECONDS,
      capability: JSON.stringify({
        [userChannelPattern]: ['subscribe'],
      }),
    });
  }
}
