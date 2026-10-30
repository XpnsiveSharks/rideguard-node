import { Global, Module } from '@nestjs/common';
import { MAIL_TRANSPORTER_FACTORY } from './mail.constants';
import { MailProvider } from './mail.provider';
import { MailService } from './mail.service';

@Global()
@Module({
  providers: [MailProvider, MailService],
  exports: [MAIL_TRANSPORTER_FACTORY, MailService],
})
export class MailModule {}
