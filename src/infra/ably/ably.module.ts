import { Global, Module } from '@nestjs/common';
import { ABLY_DEVICE_ISSUER, ABLY_REALTIME, ABLY_REST } from './ably.constants';
import { AblyDeviceIssuerProvider } from './ably-device-issuer.provider';
import { AblyRealtimeProvider } from './ably-realtime.provider';
import { AblyRestProvider } from './ably-rest.provider';

@Global()
@Module({
  providers: [AblyRestProvider, AblyRealtimeProvider, AblyDeviceIssuerProvider],
  exports: [ABLY_REST, ABLY_REALTIME, ABLY_DEVICE_ISSUER],
})
export class AblyModule {}
