import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Transporter } from 'nodemailer';
import nodemailer from 'nodemailer';
import type { SosLocation } from '@/modules/sos/sos.types';

export const SOS_EMAIL_SENDER = Symbol('SOS_EMAIL_SENDER');

export interface SosEmailSender {
  sendStart(input: { to: string; requesterName: string; location: SosLocation | null; createdAt: string }): Promise<void>;
  sendEnd(input: { to: string; requesterName: string; location: SosLocation | null; endedAt: string }): Promise<void>;
}

@Injectable()
export class NodemailerSosEmailSender implements SosEmailSender {
  private readonly transporter: Transporter | null;
  constructor(private readonly config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    const user = config.get<string>('SMTP_USER');
    const pass = config.get<string>('SMTP_PASS');
    this.transporter = host && user && pass
      ? nodemailer.createTransport({
          host,
          port: Number(config.get<string>('SMTP_PORT') ?? 587),
          secure: config.get<string>('SMTP_SECURE') === 'true',
          auth: { user, pass },
        })
      : null;
  }

  async sendStart(input: Parameters<SosEmailSender['sendStart']>[0]): Promise<void> {
    await this.send(input.to, `RideGuard SOS - ${input.requesterName}`, composeEmail(input.requesterName, input.location, `SOS raised at ${input.createdAt}.`));
  }

  async sendEnd(input: Parameters<SosEmailSender['sendEnd']>[0]): Promise<void> {
    await this.send(input.to, `RideGuard SOS ended - ${input.requesterName}`, composeEmail(input.requesterName, input.location, `SOS ended at ${input.endedAt}.`));
  }

  private async send(to: string, subject: string, text: string): Promise<void> {
    if (!this.transporter) throw new Error('SOS email delivery is not configured');
    await this.transporter.sendMail({
      from: this.config.get<string>('SMTP_FROM') ?? '"RideGuard" <noreply@rideguard.ph>',
      to,
      subject,
      text,
    });
  }
}

function composeEmail(requesterName: string, location: SosLocation | null, event: string): string {
  const map = location
    ? `\nMap: https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`
    : '\nLocation was unavailable.';
  return `RideGuard SOS for ${requesterName}.\n\n${event}${map}\n\nDo not assume the rider is safe solely because the SOS ended.`;
}
