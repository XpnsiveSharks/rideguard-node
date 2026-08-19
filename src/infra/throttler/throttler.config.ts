import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { EnvironmentVariables } from '@/config/env.validation';

export const createThrottlerOptions = (
  configService: ConfigService<EnvironmentVariables, true>,
): ThrottlerModuleOptions => ({
  throttlers: [
    {
      name: 'default',
      ttl: configService.get('THROTTLE_TTL', { infer: true }),
      limit: configService.get('THROTTLE_LIMIT', { infer: true }),
    },
  ],
  errorMessage: 'Too many requests, please try again later.',
});
