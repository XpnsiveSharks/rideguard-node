import { Module } from '@nestjs/common';
import { RealtimeController } from './realtime.controller';
import { RealtimeSubscriberService } from './service/realtime-subscriber.service';
import { InferenceHandlingService } from './service/inference-handling.service';
import { ButtonHandlingService } from './service/button-handling.service';
import { CaptureHandlingService } from './service/capture-handling.service';
import { AlertsModule } from '../alerts/alerts.module';
import { RealtimePublisherService } from './service/realtime-publishing.service';

@Module({
  imports: [AlertsModule],
  controllers: [RealtimeController],
  providers: [
    RealtimePublisherService,
    RealtimeSubscriberService,
    InferenceHandlingService,
    ButtonHandlingService,
    CaptureHandlingService,
  ],
})
export class RealtimeModule {}
