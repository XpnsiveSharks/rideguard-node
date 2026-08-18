import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { LoggerModule } from './infra/logger/logger.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), LoggerModule, AuthModule],
  providers: [],
})
export class AppModule {}
