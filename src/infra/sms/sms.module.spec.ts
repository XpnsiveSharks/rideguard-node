import { Inject, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SmsModule } from './sms.module';
import { SMS_SENDER } from './sms.constants';
import type { SmsSender } from './sms-sender.interface';
import type { SmsSendResult } from './sms.types';

// Stands in for a future caller (e.g. SOS dispatch). It depends only on the
// SMS_SENDER token and the SmsSender interface - never on SmsApiPhAdapter -
// which is the shape the ticket requires for replaceability.
@Injectable()
class FakeSosCaller {
  constructor(@Inject(SMS_SENDER) private readonly smsSender: SmsSender) {}

  notify(): Promise<SmsSendResult> {
    return this.smsSender.send({ recipient: '+639123456789', message: 'help' });
  }
}

describe('SmsModule replaceability', () => {
  it('lets a caller get a different provider behind SMS_SENDER with no caller code change', async () => {
    const stubResult: SmsSendResult = { outcome: 'accepted', providerMessageId: 'stub-1' };
    const sendMock = jest.fn().mockResolvedValue(stubResult);
    const stubSender: SmsSender = { send: sendMock };

    const moduleRef = await Test.createTestingModule({
      imports: [SmsModule],
      providers: [FakeSosCaller],
    })
      .overrideProvider(SMS_SENDER)
      .useValue(stubSender)
      .compile();

    const caller = moduleRef.get(FakeSosCaller);
    const result = await caller.notify();

    expect(result).toEqual(stubResult);
    expect(sendMock).toHaveBeenCalledWith({ recipient: '+639123456789', message: 'help' });
  });
});
