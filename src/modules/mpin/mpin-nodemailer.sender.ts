import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Transporter } from 'nodemailer';
import type { MpinEmailSender } from './mpin.service';
import { MPIN_NODEMAILER_TRANSPORTER } from './mpin-nodemailer.provider';

@Injectable()
export class NodemailerMpinEmailSender implements MpinEmailSender {
  constructor(
    @Inject(MPIN_NODEMAILER_TRANSPORTER) private readonly transporter: Transporter,
    private readonly config: ConfigService,
  ) {}

  private get from(): string {
    return this.config.get<string>('SMTP_FROM') ?? '"RideGuard" <noreply@rideguard.ph>';
  }

  async sendCode(to: string, code: string, purpose: 'change' | 'recovery'): Promise<void> {
    const label = purpose === 'change' ? 'Change' : 'Recovery';
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject: `Your RideGuard MPIN ${label} Code`,
      text: `Your RideGuard MPIN verification code is ${code}. Valid for 10 minutes.`,
      html: `<p>Your RideGuard MPIN verification code is <strong>${code}</strong>. Valid for 10 minutes.</p>`,
    });
  }

  async sendEmailLink(to: string, link: string, purpose: 'change' | 'recovery'): Promise<void> {
    const label = purpose === 'change' ? 'Change' : 'Recovery';
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject: `RideGuard MPIN ${label} Link`,
      text: `Click the link below to verify and update your RideGuard MPIN:\n\n${link}\n\nThis link expires in 15 minutes.`,
      html:
        `<p>Click the link below to verify and update your RideGuard MPIN:</p>` +
        `<p><a href="${link}">Verify MPIN</a></p>` +
        `<p>This link expires in 15 minutes.</p>`,
    });
  }
}