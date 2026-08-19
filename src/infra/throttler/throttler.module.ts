import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule as NestThrottlerModule } from '@nestjs/throttler';
import { createThrottlerOptions } from './throttler.config';

@Module({
  imports: [
    NestThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createThrottlerOptions,
    }),
  ],
  exports: [NestThrottlerModule],
})
export class ThrottlerModule {}
