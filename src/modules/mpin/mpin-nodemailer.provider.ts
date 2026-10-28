import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';

export const MPIN_NODEMAILER_TRANSPORTER = Symbol('MPIN_NODEMAILER_TRANSPORTER');

export const mpinNodemailerTransporterProvider: Provider = {
  provide: MPIN_NODEMAILER_TRANSPORTER,
  useFactory: (config: ConfigService) => {
    const host = config.get<string>('SMTP_HOST');
    const user = config.get<string>('SMTP_USER');
    const pass = config.get<string>('SMTP_PASS');
    if (!host || !user || !pass) {
      throw new Error('SMTP_HOST, SMTP_USER and SMTP_PASS must be configured');
    }
    return nodemailer.createTransport({
      host,
      port: Number(config.get<string>('SMTP_PORT') ?? 587),
      secure: config.get<string>('SMTP_SECURE') === 'true',
      auth: { user, pass },
    });
  },
  inject: [ConfigService],
};