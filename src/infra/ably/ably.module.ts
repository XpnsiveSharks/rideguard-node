import { Global, Module } from '@nestjs/common';
import { ABLY_REST } from './ably.constants';
import { AblyProvider } from './ably.provider';

@Global()
@Module({
  providers: [AblyProvider],
  exports: [ABLY_REST],
})
export class AblyModule {}
