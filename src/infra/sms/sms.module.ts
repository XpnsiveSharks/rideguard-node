import { Module } from '@nestjs/common';
import { SMS_SENDER } from './sms.constants';
import { SmsApiPhAdapter } from './sms-api-ph.adapter';

@Module({
  // Only the token is exported. Callers inject SMS_SENDER and depend on the
  // SmsSender interface; replacing the provider means changing this one
  // binding, not any caller.
  providers: [{ provide: SMS_SENDER, useClass: SmsApiPhAdapter }],
  exports: [SMS_SENDER],
})
export class SmsModule {}
