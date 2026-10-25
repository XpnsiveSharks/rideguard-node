import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@/config/env.validation';
import type { SmsSender } from './sms-sender.interface';
import type { SmsStatusChecker } from './sms-status-checker.interface';
import {
  SmsRejectionReason,
  type SmsDeliveryStatus,
  type SmsSendInput,
  type SmsSendResult,
} from './sms.types';
import {
  PH_MOBILE_NUMBER_PATTERN,
  SMS_MAX_MESSAGE_LENGTH,
  TEXTBEE_DEVICES_PATH,
  TEXTBEE_SEND_PATH,
} from './sms.constants';

// Response shapes from TextBee's API reference (reviewed 2026-10-23, not yet
// confirmed against a live account). The success body nests its fields under
// `data`; error bodies are flat. Both are read through one optional-field
// type so parsing never assumes which shape arrived.
type TextBeeResponseBody = {
  data?: {
    success?: boolean;
    message?: string;
    smsBatchId?: string;
    recipientCount?: number;
    // Present when TextBee accepted the message but expects it to fail, e.g.
    // { code: 'SMS_PERMISSION_MISSING', message: '...' } (seen live 2026-10-23).
    warning?: { code?: string; message?: string };
  };
  success?: boolean;
  error?: string;
} & Record<string, unknown>;

// Batch status lookup body (observed live 2026-10-23). One recipient per
// send, so the single message entry is the authoritative state; the batch
// status is only a fallback. Read defensively: the fields may sit under
// `data` or at the top level.
type TextBeeStatusPayload = {
  batch?: { status?: string };
  messages?: Array<{ status?: string; errorCode?: string | number }>;
};
type TextBeeStatusBody = TextBeeStatusPayload & { data?: TextBeeStatusPayload };

// Sends one SMS through TextBee, which relays it to a paired Android phone
// that sends through its own SIM. This adapter only talks to TextBee:
// authentication, payload mapping, and response/error parsing all live here.
//
// Unlike SmsApiPhAdapter, there is no fallback-channel detection here.
// TextBee has no email/push fallback - every send goes through the paired
// phone's SIM - so there is no alternate channel to misreport as SMS.
@Injectable()
export class TextBeeAdapter implements SmsSender, SmsStatusChecker {
  private readonly logger = new Logger(TextBeeAdapter.name);

  constructor(private readonly configService: ConfigService<EnvironmentVariables, true>) {}

  async send(input: SmsSendInput): Promise<SmsSendResult> {
    const validationFailure = this.validate(input);
    if (validationFailure) {
      return validationFailure;
    }

    const apiKey = this.configService.get('TEXTBEE_API_KEY', { infer: true });
    if (!apiKey) {
      // Local misconfiguration, not a provider response. Fail clearly rather
      // than attempting a call that can only fail.
      this.logger.error('SMS send skipped: TEXTBEE_API_KEY is not configured');
      return {
        outcome: 'rejected',
        reason: SmsRejectionReason.AUTHENTICATION_FAILED,
        retryable: false,
      };
    }

    const baseUrl = this.configService.get('TEXTBEE_BASE_URL', { infer: true });
    const timeoutMs = this.configService.get('TEXTBEE_TIMEOUT_MS', { infer: true });
    const deviceId = this.configService.get('TEXTBEE_DEVICE_ID', { infer: true });

    // TextBee takes an array of recipients; this adapter always sends one
    // message to one recipient. deviceId is omitted entirely when unset so
    // TextBee picks its own default device.
    const payload: { recipients: string[]; message: string; deviceId?: string } = {
      recipients: [input.recipient],
      message: input.message,
    };
    if (deviceId) {
      payload.deviceId = deviceId;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}${TEXTBEE_SEND_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const result = await this.toResult(response);
      return result.outcome === 'accepted' && deviceId ? { ...result, deviceId } : result;
    } catch (error) {
      // The request may have reached TextBee before the connection was lost
      // or the timeout fired - a queued send cannot be ruled out. Report
      // 'unknown' rather than a false rejection.
      const isTimeout = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError');
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

  // Looks up one accepted send by its smsBatchId. Never throws: any failure
  // to learn the state is 'unknown', which says nothing about the message.
  async getStatus(providerMessageId: string, sendingDeviceId?: string): Promise<SmsDeliveryStatus> {
    const apiKey = this.configService.get('TEXTBEE_API_KEY', { infer: true });
    const deviceId = sendingDeviceId ?? this.configService.get('TEXTBEE_DEVICE_ID', { infer: true });
    if (!apiKey || !deviceId) {
      // The lookup route is per-device, so the device id is required here
      // even though send() can omit it.
      this.logger.error('SMS status lookup skipped: TEXTBEE_API_KEY or TEXTBEE_DEVICE_ID not set');
      return { state: 'unknown', reason: 'not_configured' };
    }

    const baseUrl = this.configService.get('TEXTBEE_BASE_URL', { infer: true });
    const timeoutMs = this.configService.get('TEXTBEE_TIMEOUT_MS', { infer: true });
    const url =
      `${baseUrl}${TEXTBEE_DEVICES_PATH}/${encodeURIComponent(deviceId)}` +
      `/sms-batch/${encodeURIComponent(providerMessageId)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'x-api-key': apiKey },
        signal: controller.signal,
      });
      return await this.toStatus(response);
    } catch (error) {
      const isTimeout = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError');
      this.logger.warn(`SMS status unknown: ${isTimeout ? 'timeout' : 'network error'}`);
      return { state: 'unknown', reason: isTimeout ? 'timeout' : 'network_error' };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async toStatus(response: Response): Promise<SmsDeliveryStatus> {
    if (response.status === 401 || response.status === 403) {
      return { state: 'unknown', reason: 'authentication_failed' };
    }
    if (response.status === 404) {
      return { state: 'unknown', reason: 'not_found' };
    }
    if (response.status === 429) {
      return { state: 'unknown', reason: 'rate_limited', retryAfterMs: this.parseRetryAfterMs(response.headers.get('retry-after')) ?? 60000 };
    }
    if (response.status >= 500) {
      return { state: 'unknown', reason: 'server_error' };
    }

    let body: TextBeeStatusBody | undefined;
    try {
      body = (await response.json()) as TextBeeStatusBody;
    } catch {
      body = undefined;
    }
    const payload = body?.data ?? body;
    const message = payload?.messages?.[0];
    const status = response.ok ? (message?.status ?? payload?.batch?.status) : undefined;

    switch (status) {
      case 'pending':
      case 'processing':
      case 'dispatched':
        return { state: 'pending' };
      // `completed` is a batch-level status that does not distinguish sent
      // from delivered; claim only the weaker one.
      case 'sent':
      case 'completed':
        return { state: 'sent' };
      case 'delivered':
        return { state: 'delivered' };
      case 'failed': {
        const code = message?.errorCode;
        return {
          state: 'failed',
          ...(code !== undefined && /^[A-Za-z0-9_-]{1,64}$/.test(String(code)) ? { errorCode: String(code) } : {}),
        };
      }
      case 'unknown':
      case 'delivery_failed':
        return { state: 'unknown', reason: 'provider_unknown' };
      default:
        this.logger.warn(
          `TextBee returned an unrecognized status response (HTTP ${response.status})`,
        );
        return { state: 'unknown', reason: 'malformed_response' };
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
      this.logger.error(`TextBee rejected the credentials (HTTP ${response.status})`);
      return {
        outcome: 'rejected',
        reason: SmsRejectionReason.AUTHENTICATION_FAILED,
        retryable: false,
      };
    }

    if (response.status === 429) {
      // TextBee documents that nothing was sent when a quota or rate limit
      // is hit, so this is a confirmed rejection.
      const retryAfterMs = this.parseRetryAfterMs(response.headers.get('retry-after'));
      this.logger.warn('TextBee rate or quota limit hit');
      return {
        outcome: 'rejected',
        reason: SmsRejectionReason.RATE_LIMITED,
        retryable: true,
        retryAfterMs,
      };
    }

    if (response.status === 400 || response.status === 404) {
      // Known imprecision: TextBee uses 400 for several device/account
      // problems (no enabled device, device disabled, email not verified,
      // push to the phone failed, invalid device id) and 404 for a device id
      // that is not on the account. These need a human to fix the device
      // setup, not a different message, but `invalid_input` is the closest
      // existing reason.
      this.logger.warn(`TextBee rejected the request (HTTP ${response.status})`);
      return { outcome: 'rejected', reason: SmsRejectionReason.INVALID_INPUT, retryable: false };
    }

    if (response.status >= 500) {
      // Not documented by TextBee, but an HTTP error alone does not prove the
      // message was rejected before it was queued. Report 'unknown' so a
      // caller does not blindly resend and risk a duplicate.
      this.logger.warn(`TextBee outcome unknown: server error (HTTP ${response.status})`);
      return { outcome: 'unknown', reason: 'server_error' };
    }

    const body = await this.readBody(response);

    // Only an explicit `data.success: true` on a 2xx counts as acceptance.
    // TextBee returns this both when the phone is online and when it is
    // offline and the message is queued until it reconnects. Both are
    // acceptance, not delivery, which is exactly what 'accepted' means here.
    if (response.ok && body?.data?.success === true) {
      // TextBee can accept a message and still warn that it will likely fail
      // (e.g. SMS permission off on the paired phone). Pass only the code up so
      // a caller can see the risk; never the provider's free-text message.
      const warning = this.extractWarningCode(body);
      if (warning) {
        this.logger.warn(`TextBee accepted the message with a warning (${warning})`);
      }
      return {
        outcome: 'accepted',
        providerMessageId: this.extractProviderMessageId(body),
        ...(warning ? { warning } : {}),
      };
    }

    this.logger.warn(`TextBee returned an unrecognized response (HTTP ${response.status})`);
    return { outcome: 'unknown', reason: 'malformed_response' };
  }

  private async readBody(response: Response): Promise<TextBeeResponseBody | undefined> {
    try {
      return (await response.json()) as TextBeeResponseBody;
    } catch {
      return undefined;
    }
  }

  // The tracking id is nested under `data`, unlike SMS API PH's flat body.
  private extractProviderMessageId(body: TextBeeResponseBody): string | undefined {
    const candidate = body.data?.smsBatchId;
    return typeof candidate === 'string' ? candidate : undefined;
  }

  private extractWarningCode(body: TextBeeResponseBody): string | undefined {
    const code = body.data?.warning?.code;
    return typeof code === 'string' && code.length > 0 ? code : undefined;
  }

  private parseRetryAfterMs(headerValue: string | null): number | undefined {
    if (!headerValue) {
      return undefined;
    }
    const seconds = Number(headerValue);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(headerValue);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
  }
}
