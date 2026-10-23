import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@/config/env.validation';
import type { SmsSender } from './sms-sender.interface';
import { SmsRejectionReason, type SmsSendInput, type SmsSendResult } from './sms.types';
import {
  PH_MOBILE_NUMBER_PATTERN,
  SMS_MAX_MESSAGE_LENGTH,
  SMS_API_PH_SEND_PATH,
} from './sms.constants';

// Error envelope confirmed by a live probe against
// https://smsapiph.onrender.com on 2026-10-22 (missing/malformed
// credentials): `{ success: false, error: string }`.
//
// Success envelope confirmed by one live, authorized, approved test send on
// 2026-10-22 (real account, real recipient): `{ success: true, message:
// "Message sent successfully" }`. No `messageId`/`id` field was present on
// that response - this endpoint may simply not return one. `messageId`/`id`
// stay in the type as a defensive guess in case a different response
// (e.g. a different status, or a future provider version) does include one;
// `extractProviderMessageId` already handles their absence correctly.
//
// The documented provider also advertises "automatic email/push fallback".
// That one verified send did not go through fallback (no channel/fallback
// field appeared), so CHANNEL_FIELD_KEYS/FALLBACK_FIELD_KEYS below remain an
// unverified best-effort guess, not a confirmed contract - there is no
// fallback example to check them against yet. The intersection with
// `Record<string, unknown>` lets `toResult` check those unverified fields
// without assuming a fixed shape.
type SmsApiPhResponseBody = {
  success?: boolean;
  error?: string;
  message?: string;
  messageId?: string;
  id?: string;
} & Record<string, unknown>;

// Field names that might carry the channel actually used, if the provider's
// email/push fallback fires. Unverified - see the type comment above.
const CHANNEL_FIELD_KEYS = ['channel', 'deliveryChannel', 'sentVia', 'via', 'method'] as const;
// Boolean field names that might flag a fallback send directly.
const FALLBACK_FIELD_KEYS = ['fallback', 'isFallback', 'usedFallback'] as const;

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
    if (input.message.length === 0 || input.message.length > SMS_MAX_MESSAGE_LENGTH) {
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
      // A 5xx is a server-side error, not a confirmed pre-send rejection: an
      // HTTP error alone does not prove the provider rejected the message
      // before submission (it could have failed after queueing it). Report
      // 'unknown' so a caller does not blindly resend and risk a duplicate.
      this.logger.warn(`SMS API PH outcome unknown: server error (HTTP ${response.status})`);
      return { outcome: 'unknown', reason: 'server_error' };
    }

    const body = await this.readBody(response);

    // Only an explicit `success: true` on a 2xx counts as a confirmed
    // acceptance. Anything else - an unexpected status, a missing or false
    // `success` field, or a body that didn't parse as JSON - is not a
    // confirmed outcome, so it is never reported as accepted.
    if (response.ok && body?.success === true) {
      if (this.indicatesNonSmsChannel(body)) {
        // The provider's documented email/push fallback appears to have
        // fired. "Accepted" means an SMS send; do not report fallback
        // delivery as one.
        this.logger.warn(
          'SMS API PH reported success through a non-SMS channel; not reporting as SMS delivery',
        );
        return { outcome: 'unknown', reason: 'unconfirmed_channel' };
      }
      return { outcome: 'accepted', providerMessageId: this.extractProviderMessageId(body) };
    }

    this.logger.warn(`SMS API PH returned an unrecognized response (HTTP ${response.status})`);
    return { outcome: 'unknown', reason: 'malformed_response' };
  }

  // Best-effort check for the provider's documented email/push fallback.
  // Field names are unverified (see the type comment on
  // SmsApiPhResponseBody); this stays defensive until a real account
  // confirms the actual contract.
  private indicatesNonSmsChannel(body: SmsApiPhResponseBody): boolean {
    for (const key of CHANNEL_FIELD_KEYS) {
      const value = body[key];
      if (typeof value === 'string' && !/sms/i.test(value)) {
        return true;
      }
    }
    return FALLBACK_FIELD_KEYS.some((key) => body[key] === true);
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
