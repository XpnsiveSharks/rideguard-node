import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { EnvironmentVariables } from '@/config/env.validation';
import { MAIL_TRANSPORTER_FACTORY } from './mail.constants';

export type MailTransporterFactory = {
  getTransporter(): Transporter;
};

/**
 * Lazily builds a Nodemailer SMTP transport on first use. Missing SMTP env
 * vars log one warning and fail at send time — they never block app boot.
 */
export const MailProvider = {
  provide: MAIL_TRANSPORTER_FACTORY,
  inject: [ConfigService],

  useFactory: (
    configService: ConfigService<EnvironmentVariables, true>,
  ): MailTransporterFactory => {
    const logger = new Logger('MailProvider');
    let transporter: Transporter | null = null;
    let warnedMissingConfig = false;

    return {
      getTransporter(): Transporter {
        const host = configService.get('SMTP_HOST', { infer: true });
        const user = configService.get('SMTP_USER', { infer: true });
        const pass = configService.get('SMTP_PASS', { infer: true });

        if (!host || !user || !pass) {
          if (!warnedMissingConfig) {
            logger.warn(
              'SMTP_HOST, SMTP_USER, and SMTP_PASS are not fully configured; email send will fail until they are set',
            );
            warnedMissingConfig = true;
          }
          throw new ServiceUnavailableException(
            'Email service is not configured. Please try again later.',
          );
        }

        if (!transporter) {
          transporter = nodemailer.createTransport({
            host,
            port: configService.get('SMTP_PORT', { infer: true }),
            secure: configService.get('SMTP_SECURE', { infer: true }),
            auth: { user, pass },
          });
        }

        return transporter;
      },
    };
  },
};
