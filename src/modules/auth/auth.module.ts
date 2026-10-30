import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MailModule } from '@/infra/mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccountDeletionProcessorService } from './account-deletion-processor.service';
import { FirebaseAuthGuard } from './guards/firebase-auth.guard';

@Module({
  imports: [MailModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccountDeletionProcessorService,
    // Guards every route in the app; opt out per-route with @Public().
    { provide: APP_GUARD, useClass: FirebaseAuthGuard },
  ],
  exports: [AuthService, AccountDeletionProcessorService],
})
export class AuthModule {}
