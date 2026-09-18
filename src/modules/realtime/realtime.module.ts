import { Module } from '@nestjs/common';
import { RealtimeController } from './realtime.controller';
import { RealtimeService } from './realtime.service';
import { InferenceSubscriberService } from './service/inference-subscriber.service';
import { InferenceHandlingService } from './service/inference-handling.service';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [AlertsModule],
  controllers: [RealtimeController],
  providers: [RealtimeService, InferenceSubscriberService, InferenceHandlingService],
})
export class RealtimeModule {}
