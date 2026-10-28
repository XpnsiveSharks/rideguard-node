import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MpinController } from './mpin.controller';
import { MpinService, MPIN_EMAIL_SENDER } from './mpin.service';
import { mpinNodemailerTransporterProvider } from './mpin-nodemailer.provider';
import { NodemailerMpinEmailSender } from './mpin-nodemailer.sender';

@Module({
  imports: [ConfigModule],                       // or rely on a global ConfigModule
  controllers: [MpinController],
  providers: [
    MpinService,
    mpinNodemailerTransporterProvider,
    { provide: MPIN_EMAIL_SENDER, useClass: NodemailerMpinEmailSender },
  ],
  exports: [MpinService],
})
export class MpinModule {}