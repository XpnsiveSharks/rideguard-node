import { ConfigService } from '@nestjs/config';
import { Rest } from 'ably';
import type { EnvironmentVariables } from '@/config/env.validation';
import { ABLY_LOG_LEVEL_ERRORS_ONLY, ABLY_REST } from './ably.constants';

export const createAblyRestClient = (
  configService: ConfigService<EnvironmentVariables, true>,
): Rest => {
  try {
    return new Rest({
      key: configService.get('ABLY_API_KEY', { infer: true }),
      logLevel: ABLY_LOG_LEVEL_ERRORS_ONLY,
    });
  } catch {
    throw new Error('Failed to initialize the Ably client: ABLY_API_KEY was rejected by the SDK');
  }
};

export const AblyProvider = {
  provide: ABLY_REST,
  inject: [ConfigService],
  useFactory: createAblyRestClient,
};
