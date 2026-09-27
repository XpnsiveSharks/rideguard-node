import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushRegistrationsRepository } from './infrastructure/push-registrations.repository';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, PushRegistrationsRepository],
})
export class NotificationsModule {}
