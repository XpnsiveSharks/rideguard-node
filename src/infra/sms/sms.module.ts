import { Module } from '@nestjs/common';
import { SMS_SENDER } from './sms.constants';
import { TextBeeAdapter } from './textbee.adapter';

@Module({
  // Only the token is exported. Callers inject SMS_SENDER and depend on the
  // SmsSender interface; replacing the provider means changing this one
  // binding, not any caller.
  //
  // SmsApiPhAdapter (sms-api-ph.adapter.ts) remains in the tree, untouched,
  // as the previous provider. It is intentionally not listed here: Nest
  // instantiates every provider a module lists at bootstrap, and nothing
  // uses it now. Swap back by changing only the line below.
  providers: [{ provide: SMS_SENDER, useClass: TextBeeAdapter }],
  exports: [SMS_SENDER],
})
export class SmsModule {}
