import { Module } from '@nestjs/common';
import { AblyModule } from '@/infra/ably/ably.module';
import { FirebaseModule } from '@/infra/firebase/firebase.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [FirebaseModule, AblyModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
