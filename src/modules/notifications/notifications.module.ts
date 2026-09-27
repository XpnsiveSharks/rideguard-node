import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushRegistrationsRepository } from './infrastructure/push-registrations.repository';
import { FcmPushAdapter } from './infrastructure/fcm-push.adapter';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, PushRegistrationsRepository, FcmPushAdapter],
})
export class NotificationsModule {}
