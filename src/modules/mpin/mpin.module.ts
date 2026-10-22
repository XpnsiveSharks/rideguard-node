import { Module } from '@nestjs/common';
import { MpinController } from './mpin.controller';
import { MpinService, MPIN_EMAIL_SENDER, MissingMpinEmailSender } from './mpin.service';

@Module({
  controllers: [MpinController],
  providers: [MpinService, { provide: MPIN_EMAIL_SENDER, useClass: MissingMpinEmailSender }],
})
export class MpinModule {}
