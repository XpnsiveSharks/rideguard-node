import { ConfigService } from '@nestjs/config';
import { Realtime } from 'ably';
import type { EnvironmentVariables } from '@/config/env.validation';
import { ABLY_LOG_LEVEL_ERRORS_ONLY, ABLY_REALTIME } from './ably.constants';

export const createAblyRealtimeClient = (
  configService: ConfigService<EnvironmentVariables, true>,
): Realtime => {
  try {
    return new Realtime({
      key: configService.get('UPSTREAM_ABLY_API_KEY', { infer: true }),
      logLevel: ABLY_LOG_LEVEL_ERRORS_ONLY,
    });
  } catch {
    throw new Error(
      'Failed to initialize the Ably Realtime client: UPSTREAM_ABLY_API_KEY was rejected by the SDK',
    );
  }
};

export const AblyRealtimeProvider = {
  provide: ABLY_REALTIME,
  inject: [ConfigService],
  useFactory: createAblyRealtimeClient,
};
