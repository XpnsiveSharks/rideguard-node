import { Module } from '@nestjs/common';
import { SMS_SENDER, SMS_STATUS_CHECKER } from './sms.constants';
import { SmsDeliveryTracker } from './sms-delivery-tracker';
import { TextBeeAdapter } from './textbee.adapter';

@Module({
  // Callers inject SMS_SENDER / SMS_STATUS_CHECKER and depend on the
  // SmsSender / SmsStatusChecker interfaces; replacing the provider means
  // changing these bindings, not any caller. Both resolve to the same
  // (stateless) adapter class.
  //
  // SmsApiPhAdapter (sms-api-ph.adapter.ts) remains in the tree, untouched,
  // as the previous provider. It is intentionally not listed here: Nest
  // instantiates every provider a module lists at bootstrap, and nothing
  // uses it now. It has no status lookup, so swapping back also means
  // dropping the SMS_STATUS_CHECKER binding.
  providers: [
    { provide: SMS_SENDER, useClass: TextBeeAdapter },
    { provide: SMS_STATUS_CHECKER, useClass: TextBeeAdapter },
    SmsDeliveryTracker,
  ],
  exports: [SMS_SENDER, SMS_STATUS_CHECKER, SmsDeliveryTracker],
})
export class SmsModule {}
