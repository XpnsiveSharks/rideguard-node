import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertsRepository } from './infrastructure/alerts.repository';
import { InferenceAlertsRepository } from './infrastructure/inference-alerts.repository';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { AutoArchiveProcessorService } from '../settings/auto-archive-processor.service';

@Module({
  imports: [NotificationsModule, SettingsModule],
  controllers: [AlertsController],
  providers: [
    AlertsService,
    AlertsRepository,
    InferenceAlertsRepository,
    AutoArchiveProcessorService,
  ],
  exports: [AlertsService, AlertsRepository],
})
export class AlertsModule {}
