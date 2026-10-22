import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@/config/env.validation';
import { SmsApiPhAdapter } from './sms-api-ph.adapter';
import { SMS_API_PH_SEND_PATH } from './sms.constants';

const VALID_RECIPIENT = '+639123456789';
const VALID_MESSAGE = 'RideGuard SOS: test message';

function fakeConfig(
  overrides: Partial<EnvironmentVariables> = {},
): ConfigService<EnvironmentVariables, true> {
  const values: Partial<EnvironmentVariables> = {
    SMS_API_PH_BASE_URL: 'https://smsapiph.onrender.com',
    SMS_API_PH_API_KEY: 'a-configured-key',
    SMS_API_PH_TIMEOUT_MS: 5000,
    ...overrides,
  };
  return {
    get: jest.fn((key: keyof EnvironmentVariables) => values[key]),
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe('SmsApiPhAdapter.send', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('reports accepted with the provider message id on a confirmed success', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { success: true, messageId: 'abc-123' }));
    global.fetch = fetchMock;

    const adapter = new SmsApiPhAdapter(fakeConfig());
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

    expect(result).toEqual({ outcome: 'accepted', providerMessageId: 'abc-123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toBe(`https://smsapiph.onrender.com${SMS_API_PH_SEND_PATH}`);
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe('a-configured-key');
    expect(JSON.parse(init.body as string)).toEqual({
      recipient: VALID_RECIPIENT,
      message: VALID_MESSAGE,
    });
  });

  it('reports accepted without a message id when the provider omits one', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, { success: true }));

    const adapter = new SmsApiPhAdapter(fakeConfig());
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

    expect(result).toEqual({ outcome: 'accepted', providerMessageId: undefined });
  });

  it('still reports accepted when a channel field explicitly confirms sms', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { success: true, channel: 'sms', messageId: 'id-1' }));

    const adapter = new SmsApiPhAdapter(fakeConfig());
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

    expect(result).toEqual({ outcome: 'accepted', providerMessageId: 'id-1' });
  });

  it.each(['channel', 'deliveryChannel', 'sentVia', 'via', 'method'])(
    "does not report accepted when success:true but '%s' names a non-sms channel",
    async (field) => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(
          jsonResponse(200, { success: true, [field]: 'email', messageId: 'id-1' }),
        );

      const adapter = new SmsApiPhAdapter(fakeConfig());
      const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

      // A provider fallback to email/push is not a confirmed SMS send.
      expect(result).toEqual({ outcome: 'unknown', reason: 'unconfirmed_channel' });
    },
  );

  it.each(['fallback', 'isFallback', 'usedFallback'])(
    "does not report accepted when success:true but '%s' is true",
    async (field) => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(jsonResponse(200, { success: true, [field]: true }));

      const adapter = new SmsApiPhAdapter(fakeConfig());
      const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

      expect(result).toEqual({ outcome: 'unknown', reason: 'unconfirmed_channel' });
    },
  );

  it.each([401, 403])(
    'reports a non-retryable authentication rejection on HTTP %i',
    async (status) => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(jsonResponse(status, { success: false, error: 'nope' }));

      const adapter = new SmsApiPhAdapter(fakeConfig());
      const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

      expect(result).toEqual({
        outcome: 'rejected',
        reason: 'authentication_failed',
        retryable: false,
      });
    },
  );

  it('reports a retryable rate-limit rejection on HTTP 429 with the retry-after header', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(429, { success: false, error: 'slow down' }, { 'retry-after': '30' }),
      );

    const adapter = new SmsApiPhAdapter(fakeConfig());
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

    expect(result).toEqual({
      outcome: 'rejected',
      reason: 'rate_limited',
      retryable: true,
      retryAfterMs: 30000,
    });
  });

  it('reports a non-retryable rejection on HTTP 400', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(400, { success: false, error: 'bad input' }));

    const adapter = new SmsApiPhAdapter(fakeConfig());
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

    expect(result).toEqual({ outcome: 'rejected', reason: 'invalid_input', retryable: false });
  });

  it.each([500, 503])(
    'reports unknown/server_error on HTTP %i rather than a confirmed rejection',
    async (status) => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(jsonResponse(status, { success: false, error: 'down' }));

      const adapter = new SmsApiPhAdapter(fakeConfig());
      const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

      // A 5xx does not prove the provider rejected the message before
      // submission - it could have failed after queueing it - so this must
      // never come back as 'rejected' (which would license a blind retry).
      expect(result).toEqual({ outcome: 'unknown', reason: 'server_error' });
    },
  );

  it('reports unknown/malformed_response rather than false success when the body is not valid JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('not json', { status: 200 }));

    const adapter = new SmsApiPhAdapter(fakeConfig());
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

    expect(result).toEqual({ outcome: 'unknown', reason: 'malformed_response' });
  });

  it('reports unknown/malformed_response rather than false success on 2xx without success: true', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, { data: 'something else' }));

    const adapter = new SmsApiPhAdapter(fakeConfig());
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

    expect(result).toEqual({ outcome: 'unknown', reason: 'malformed_response' });
  });

  it('reports unknown/timeout when the request aborts after submission', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(abortError);

    const adapter = new SmsApiPhAdapter(fakeConfig());
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

    expect(result).toEqual({ outcome: 'unknown', reason: 'timeout' });
  });

  it('reports unknown/network_error on a connection failure, never a false rejection', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('fetch failed'));

    const adapter = new SmsApiPhAdapter(fakeConfig());
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

    expect(result).toEqual({ outcome: 'unknown', reason: 'network_error' });
  });

  it('rejects an invalid recipient locally without calling the network', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const adapter = new SmsApiPhAdapter(fakeConfig());
    const result = await adapter.send({ recipient: '09123456789', message: VALID_MESSAGE });

    expect(result).toEqual({ outcome: 'rejected', reason: 'invalid_recipient', retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an oversized message locally without calling the network', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const adapter = new SmsApiPhAdapter(fakeConfig());
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: 'x'.repeat(161) });

    expect(result).toEqual({ outcome: 'rejected', reason: 'message_too_long', retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an empty message locally without calling the network', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const adapter = new SmsApiPhAdapter(fakeConfig());
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: '' });

    expect(result).toEqual({ outcome: 'rejected', reason: 'message_too_long', retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails clearly without calling the network when no API key is configured', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const adapter = new SmsApiPhAdapter(fakeConfig({ SMS_API_PH_API_KEY: '' }));
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

    expect(result).toEqual({
      outcome: 'rejected',
      reason: 'authentication_failed',
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
