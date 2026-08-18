import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FirebaseModule } from '@/infra/firebase/firebase.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { FirebaseAuthGuard } from './guards/firebase-auth.guard';

@Module({
  imports: [FirebaseModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Guards every route in the app; opt out per-route with @Public().
    { provide: APP_GUARD, useClass: FirebaseAuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
