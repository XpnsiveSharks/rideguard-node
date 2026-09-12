import { Module } from '@nestjs/common';
import { InferenceController } from './inference.controller';
import { InferenceService } from './inference.service';
import { InferenceSubscriberService } from './service/inference-subscriber.service';

@Module({
  controllers: [InferenceController],
  providers: [InferenceService, InferenceSubscriberService],
})
export class InferenceModule {}
