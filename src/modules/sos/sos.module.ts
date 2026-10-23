import { Module } from '@nestjs/common';
import { SmsModule } from '@/infra/sms/sms.module';
import { AlertSosController, SosController } from './sos.controller';
import { AlertsModule } from '../alerts/alerts.module';
import { SosService } from './sos.service';
import { SosRepository } from './infrastructure/sos.repository';

// ProfileModule is global, so ProfileService needs no import here.
@Module({
  imports: [SmsModule, AlertsModule],
  controllers: [SosController, AlertSosController],
  providers: [SosService, SosRepository],
})
export class SosModule {}
