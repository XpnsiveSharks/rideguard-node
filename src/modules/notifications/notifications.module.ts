import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushRegistrationsRepository } from './infrastructure/push-registrations.repository';
import { FcmPushAdapter } from './infrastructure/fcm-push.adapter';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, PushRegistrationsRepository, FcmPushAdapter],
  // Exported so other feature modules (e.g. alerts) can send push notifications
  // through the service instead of reaching into this module's internals.
  exports: [NotificationsService],
})
export class NotificationsModule {}
