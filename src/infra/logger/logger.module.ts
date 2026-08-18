import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { createLoggerOptions } from './logger.config';

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createLoggerOptions,
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
