import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@/config/env.validation';
import { MAIL_TRANSPORTER_FACTORY } from './mail.constants';
import type { MailTransporterFactory } from './mail.provider';

@Injectable()
export class MailService {
  constructor(
    @Inject(MAIL_TRANSPORTER_FACTORY)
    private readonly transporterFactory: MailTransporterFactory,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  private get from(): string {
    const configured = this.config.get('SMTP_FROM', { infer: true });
    return configured || '"RideGuard" <noreply@rideguard.ph>';
  }

  async sendVerificationCode(to: string, code: string): Promise<void> {
    const transporter = this.transporterFactory.getTransporter();
    await transporter.sendMail({
      from: this.from,
      to,
      subject: 'Your RideGuard verification code',
      text: `Your RideGuard verification code is ${code}. It expires in 10 minutes.`,
      html:
        `<p>Your RideGuard verification code is <strong>${code}</strong>.</p>` +
        `<p>It expires in 10 minutes.</p>`,
    });
  }
}
