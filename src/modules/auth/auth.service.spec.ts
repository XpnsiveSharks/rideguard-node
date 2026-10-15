import type { Auth } from 'firebase-admin/auth';
import type { Rest, TokenRequest } from 'ably';

import { ONE_HOUR_IN_MILLISECONDS } from '@/common/constants/time.constants';
import { REALTIME_CHANNELS } from '@/modules/realtime/realtime.constants';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  it('allows mobile clients to subscribe to alerts and button events', async () => {
    const tokenRequest = {} as TokenRequest;
    const createTokenRequest = jest.fn().mockResolvedValue(tokenRequest);
    const auth = {} as Auth;
    const ably = {
      auth: { createTokenRequest },
    } as unknown as Rest;
    const service = new AuthService(auth, ably);
    const userId = 'user-123';

    await expect(service.createAblyTokenRequest(userId)).resolves.toBe(tokenRequest);

    expect(createTokenRequest).toHaveBeenCalledTimes(1);
    expect(createTokenRequest).toHaveBeenCalledWith({
      clientId: userId,
      ttl: ONE_HOUR_IN_MILLISECONDS,
      capability: JSON.stringify({
        [REALTIME_CHANNELS.alertsForUser(userId)]: ['subscribe'],
        [REALTIME_CHANNELS.buttonEvents]: ['subscribe'],
      }),
    });
  });
});
