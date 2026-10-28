import { Module } from '@nestjs/common';
import { MpinController } from './mpin.controller';
import { FirebaseMpinEmailSender, MPIN_EMAIL_SENDER, MpinService } from './mpin.service';

@Module({
  controllers: [MpinController],
  providers: [
    MpinService,
    FirebaseMpinEmailSender,
    { provide: MPIN_EMAIL_SENDER, useClass: FirebaseMpinEmailSender },
  ],
  exports: [MpinService],
})
export class MpinModule {}
