import { Module } from '@nestjs/common';
import { FirebaseModule } from '@/infra/firebase/firebase.module';
import { StationsController } from './stations.controller';
import { StationsService } from './stations.service';

@Module({
  imports: [FirebaseModule],
  controllers: [StationsController],
  providers: [StationsService],
  exports: [StationsService],
})
export class StationsModule {}
