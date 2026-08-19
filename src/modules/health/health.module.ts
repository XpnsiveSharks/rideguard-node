import { Module } from '@nestjs/common';
import { FirebaseModule } from '@/infra/firebase/firebase.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [FirebaseModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
