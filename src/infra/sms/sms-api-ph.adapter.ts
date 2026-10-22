import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@/config/env.validation';
import type { SmsSender } from './sms-sender.interface';
import { SmsRejectionReason, type SmsSendInput, type SmsSendResult } from './sms.types';
import {
  PH_MOBILE_NUMBER_PATTERN,
  SMS_API_PH_MAX_MESSAGE_LENGTH,
  SMS_API_PH_SEND_PATH,
} from './sms.constants';

// The one error envelope shape confirmed by a live probe against
// https://smsapiph.onrender.com on 2026-10-22 (missing/malformed
// credentials): `{ success: false, error: string }`. The success response
// shape has not been confirmed against a real account, so parsing it stays
// defensive until it is.
type SmsApiPhResponseBody = {
  success?: boolean;
  error?: string;
  messageId?: string;
  id?: string;
};

// Sends one SMS through SMS API PH. This adapter only talks to that
// provider: authentication, payload mapping, and response/error parsing all
// live here. Recipient selection and message composition belong to the
// calling application service.
@Injectable()
export class SmsApiPhAdapter implements SmsSender {
  private readonly logger = new Logger(SmsApiPhAdapter.name);

  constructor(private readonly configService: ConfigService<EnvironmentVariables, true>) {}

  async send(input: SmsSendInput): Promise<SmsSendResult> {
    const validationFailure = this.validate(input);
    if (validationFailure) {
      return validationFailure;
    }

    const apiKey = this.configService.get('SMS_API_PH_API_KEY', { infer: true });
    if (!apiKey) {
      // Local misconfiguration, not a provider response. Fail clearly rather
      // than attempting a call that can only fail.
      this.logger.error('SMS send skipped: SMS_API_PH_API_KEY is not configured');
      return {
        outcome: 'rejected',
        reason: SmsRejectionReason.AUTHENTICATION_FAILED,
        retryable: false,
      };
    }

    const baseUrl = this.configService.get('SMS_API_PH_BASE_URL', { infer: true });
    const timeoutMs = this.configService.get('SMS_API_PH_TIMEOUT_MS', { infer: true });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}${SMS_API_PH_SEND_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ recipient: input.recipient, message: input.message }),
        signal: controller.signal,
      });

      return await this.toResult(response);
    } catch (error) {
      // The request may have reached the provider before the connection was
      // lost or the timeout fired - a confirmed send cannot be ruled out.
      // Report 'unknown' rather than a false rejection; the caller decides
      // whether an uncertain outcome is safe to retry.
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      this.logger.warn(
        isTimeout
          ? 'SMS send outcome unknown: request timed out after submission'
          : 'SMS send outcome unknown: network error after submission',
      );
      return { outcome: 'unknown', reason: isTimeout ? 'timeout' : 'network_error' };
    } finally {
      clearTimeout(timeout);
    }
  }

  private validate(input: SmsSendInput): SmsSendResult | undefined {
    if (!PH_MOBILE_NUMBER_PATTERN.test(input.recipient)) {
      return {
        outcome: 'rejected',
        reason: SmsRejectionReason.INVALID_RECIPIENT,
        retryable: false,
      };
    }
    if (input.message.length === 0 || input.message.length > SMS_API_PH_MAX_MESSAGE_LENGTH) {
      return { outcome: 'rejected', reason: SmsRejectionReason.MESSAGE_TOO_LONG, retryable: false };
    }
    return undefined;
  }

  private async toResult(response: Response): Promise<SmsSendResult> {
    if (response.status === 401 || response.status === 403) {
      this.logger.error(`SMS API PH rejected the credentials (HTTP ${response.status})`);
      return {
        outcome: 'rejected',
        reason: SmsRejectionReason.AUTHENTICATION_FAILED,
        retryable: false,
      };
    }

    if (response.status === 429) {
      const retryAfterMs = this.parseRetryAfterMs(response.headers.get('retry-after'));
      this.logger.warn('SMS API PH rate limit hit');
      return {
        outcome: 'rejected',
        reason: SmsRejectionReason.RATE_LIMITED,
        retryable: true,
        retryAfterMs,
      };
    }

    if (response.status === 400) {
      this.logger.warn('SMS API PH rejected the request (HTTP 400)');
      return { outcome: 'rejected', reason: SmsRejectionReason.INVALID_INPUT, retryable: false };
    }

    if (response.status >= 500) {
      this.logger.warn(`SMS API PH server error (HTTP ${response.status})`);
      return { outcome: 'rejected', reason: SmsRejectionReason.PROVIDER_ERROR, retryable: true };
    }

    const body = await this.readBody(response);

    // Only an explicit `success: true` on a 2xx counts as a confirmed
    // acceptance. Anything else - an unexpected status, a missing or false
    // `success` field, or a body that didn't parse as JSON - is not a
    // confirmed outcome, so it is never reported as accepted.
    if (response.ok && body?.success === true) {
      return { outcome: 'accepted', providerMessageId: this.extractProviderMessageId(body) };
    }

    this.logger.warn(`SMS API PH returned an unrecognized response (HTTP ${response.status})`);
    return { outcome: 'unknown', reason: 'malformed_response' };
  }

  private async readBody(response: Response): Promise<SmsApiPhResponseBody | undefined> {
    try {
      return (await response.json()) as SmsApiPhResponseBody;
    } catch {
      return undefined;
    }
  }

  private extractProviderMessageId(body: SmsApiPhResponseBody): string | undefined {
    const candidate = body.messageId ?? body.id;
    return typeof candidate === 'string' ? candidate : undefined;
  }

  private parseRetryAfterMs(headerValue: string | null): number | undefined {
    if (!headerValue) {
      return undefined;
    }
    const seconds = Number(headerValue);
    return Number.isFinite(seconds) ? seconds * 1000 : undefined;
  }
}
