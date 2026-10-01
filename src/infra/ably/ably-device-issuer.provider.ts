import { ConfigService } from '@nestjs/config';
import { Rest } from 'ably';
import type { EnvironmentVariables } from '@/config/env.validation';
import { ABLY_DEVICE_ISSUER, ABLY_LOG_LEVEL_ERRORS_ONLY } from './ably.constants';

export const createAblyDeviceIssuer = (
  configService: ConfigService<EnvironmentVariables, true>,
): Rest => {
  try {
    return new Rest({
      key: configService.get('DEVICE_ABLY_ISSUER_API_KEY', { infer: true }),
      logLevel: ABLY_LOG_LEVEL_ERRORS_ONLY,
    });
  } catch {
    throw new Error(
      'Failed to initialize the Ably device issuer: DEVICE_ABLY_ISSUER_API_KEY was rejected by the SDK',
    );
  }
};

export const AblyDeviceIssuerProvider = {
  provide: ABLY_DEVICE_ISSUER,
  inject: [ConfigService],
  useFactory: createAblyDeviceIssuer,
};
