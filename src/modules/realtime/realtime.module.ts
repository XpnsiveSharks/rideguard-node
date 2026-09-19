import { Module } from '@nestjs/common';
import { RealtimeController } from './realtime.controller';
import { InferenceSubscriberService } from './service/inference-subscriber.service';
import { InferenceHandlingService } from './service/inference-handling.service';
import { AlertsModule } from '../alerts/alerts.module';
import { RealtimePublisherService } from './service/realtime-publishing.service';

@Module({
  imports: [AlertsModule],
  controllers: [RealtimeController],
  providers: [RealtimePublisherService, InferenceSubscriberService, InferenceHandlingService],
})
export class RealtimeModule {}
