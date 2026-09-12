import { Module } from '@nestjs/common';
import { InferenceController } from './inference.controller';
import { InferenceService } from './inference.service';
import { InferenceSubscriberService } from './service/inference-subscriber.service';
import { InferenceHandlingService } from './service/inference-handling.service';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [AlertsModule],
  controllers: [InferenceController],
  providers: [InferenceService, InferenceSubscriberService, InferenceHandlingService],
})
export class InferenceModule {}
