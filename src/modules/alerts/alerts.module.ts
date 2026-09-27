import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertsRepository } from './infrastructure/alerts.repository';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [AlertsController],
  providers: [AlertsService, AlertsRepository],
  exports: [AlertsService],
})
export class AlertsModule {}
