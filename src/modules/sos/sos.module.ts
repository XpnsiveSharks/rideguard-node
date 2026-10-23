import { Module } from '@nestjs/common';
import { SmsModule } from '@/infra/sms/sms.module';
import { SosController } from './sos.controller';
import { SosService } from './sos.service';
import { SosRepository } from './infrastructure/sos.repository';

// ProfileModule is global, so ProfileService needs no import here.
@Module({
  imports: [SmsModule],
  controllers: [SosController],
  providers: [SosService, SosRepository],
})
export class SosModule {}
