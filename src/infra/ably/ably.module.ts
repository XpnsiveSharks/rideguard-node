import { Global, Module } from '@nestjs/common';
import { ABLY_REALTIME, ABLY_REST } from './ably.constants';
import { AblyRealtimeProvider } from './ably-realtime.provider';
import { AblyRestProvider } from './ably-rest.provider';

@Global()
@Module({
  providers: [AblyRestProvider, AblyRealtimeProvider],
  exports: [ABLY_REST, ABLY_REALTIME],
})
export class AblyModule {}
