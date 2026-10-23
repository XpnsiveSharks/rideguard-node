import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@/config/env.validation';
import { TextBeeAdapter } from './textbee.adapter';
import { TEXTBEE_SEND_PATH } from './sms.constants';

const VALID_RECIPIENT = '+639123456789';
const VALID_MESSAGE = 'RideGuard SOS: test message';

function fakeConfig(
  overrides: Partial<EnvironmentVariables> = {},
): ConfigService<EnvironmentVariables, true> {
  const values: Partial<EnvironmentVariables> = {
    TEXTBEE_BASE_URL: 'https://api.textbee.dev',
    TEXTBEE_API_KEY: 'a-configured-key',
    TEXTBEE_DEVICE_ID: '',
    TEXTBEE_TIMEOUT_MS: 5000,
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

const successBody = (extra: Record<string, unknown> = {}) => ({
  data: {
    success: true,
    message: 'SMS added to queue for processing',
    smsBatchId: 'batch-123',
    recipientCount: 1,
    ...extra,
  },
});

type SentRequest = [string, RequestInit & { headers: Record<string, string> }];

describe('TextBeeAdapter.send', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('reports accepted with the batch id and sends the documented request', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(200, successBody()));
    global.fetch = fetchMock;

    const adapter = new TextBeeAdapter(fakeConfig());
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

    expect(result).toEqual({ outcome: 'accepted', providerMessageId: 'batch-123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as SentRequest;
    expect(url).toBe(`https://api.textbee.dev${TEXTBEE_SEND_PATH}`);
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe('a-configured-key');
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent).toEqual({ recipients: [VALID_RECIPIENT], message: VALID_MESSAGE });
    expect(sent).not.toHaveProperty('deviceId');
  });

  it('includes deviceId in the request only when one is configured', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(200, successBody()));
    global.fetch = fetchMock;

    const adapter = new TextBeeAdapter(fakeConfig({ TEXTBEE_DEVICE_ID: 'device-abc' }));
    await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

    const [, init] = fetchMock.mock.calls[0] as SentRequest;
    expect(JSON.parse(init.body as string)).toEqual({
      recipients: [VALID_RECIPIENT],
      message: VALID_MESSAGE,
      deviceId: 'device-abc',
    });
  });

  it('reports accepted without a message id when the batch id is absent', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { data: { success: true, recipientCount: 1 } }));

    const adapter = new TextBeeAdapter(fakeConfig());
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

    expect(result).toEqual({ outcome: 'accepted', providerMessageId: undefined });
  });

  it('reports plain accepted when the phone is offline and the message is queued', async () => {
    // TextBee still returns 200 with data.success: true and holds the message
    // until the phone reconnects. That is acceptance, not delivery, so it is
    // deliberately not special-cased.
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(
        200,
        successBody({
          message: 'SMS added to queue for processing',
          warning: { code: 'OFFLINE' },
        }),
      ),
    );

    const adapter = new TextBeeAdapter(fakeConfig());
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

    expect(result).toEqual({ outcome: 'accepted', providerMessageId: 'batch-123' });
  });

  it.each([401, 403])(
    'reports a non-retryable authentication rejection on HTTP %i',
    async (status) => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(jsonResponse(status, { success: false, error: 'bad key' }));

      const adapter = new TextBeeAdapter(fakeConfig());
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
        jsonResponse(429, { success: false, error: 'limit used up' }, { 'retry-after': '30' }),
      );

    const adapter = new TextBeeAdapter(fakeConfig());
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

    expect(result).toEqual({
      outcome: 'rejected',
      reason: 'rate_limited',
      retryable: true,
      retryAfterMs: 30000,
    });
  });

  it('reports rate_limited without retryAfterMs when no retry-after header is sent', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(429, { success: false, error: 'limit used up' }));

    const adapter = new TextBeeAdapter(fakeConfig());
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

    expect(result).toEqual({
      outcome: 'rejected',
      reason: 'rate_limited',
      retryable: true,
      retryAfterMs: undefined,
    });
  });

  it.each([
    [400, 'No enabled device found. Enable a device or pass a deviceId.'],
    [400, 'Invalid device id'],
    [404, 'Device not found'],
  ])('reports a non-retryable invalid_input rejection on HTTP %i (%s)', async (status, error) => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(status, { success: false, error }));

    const adapter = new TextBeeAdapter(fakeConfig());
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

    expect(result).toEqual({ outcome: 'rejected', reason: 'invalid_input', retryable: false });
  });

  it.each([500, 503])(
    'reports unknown/server_error on HTTP %i rather than a confirmed rejection',
    async (status) => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(jsonResponse(status, { success: false, error: 'down' }));

      const adapter = new TextBeeAdapter(fakeConfig());
      const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

      // A 5xx does not prove the message was rejected before it was queued, so
      // it must never come back as 'rejected' (which would license a blind retry).
      expect(result).toEqual({ outcome: 'unknown', reason: 'server_error' });
    },
  );

  it('reports unknown/malformed_response when a 2xx body is not valid JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('not json', { status: 200 }));

    const adapter = new TextBeeAdapter(fakeConfig());
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

    expect(result).toEqual({ outcome: 'unknown', reason: 'malformed_response' });
  });

  it.each([
    ['data.success is false', { data: { success: false } }],
    ['data is missing', { success: true }],
    ['the body is unrelated', { hello: 'world' }],
  ])('reports unknown/malformed_response on a 2xx when %s', async (_label, body) => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, body));

    const adapter = new TextBeeAdapter(fakeConfig());
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

    expect(result).toEqual({ outcome: 'unknown', reason: 'malformed_response' });
  });

  it('reports unknown/timeout when the request aborts after submission', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(abortError);

    const adapter = new TextBeeAdapter(fakeConfig());
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

    expect(result).toEqual({ outcome: 'unknown', reason: 'timeout' });
  });

  it('reports unknown/network_error on a connection failure, never a false rejection', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('fetch failed'));

    const adapter = new TextBeeAdapter(fakeConfig());
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

    expect(result).toEqual({ outcome: 'unknown', reason: 'network_error' });
  });

  it('rejects an invalid recipient locally without calling the network', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const adapter = new TextBeeAdapter(fakeConfig());
    const result = await adapter.send({ recipient: '09123456789', message: VALID_MESSAGE });

    expect(result).toEqual({ outcome: 'rejected', reason: 'invalid_recipient', retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an oversized message locally without calling the network', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const adapter = new TextBeeAdapter(fakeConfig());
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: 'x'.repeat(161) });

    expect(result).toEqual({ outcome: 'rejected', reason: 'message_too_long', retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an empty message locally without calling the network', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const adapter = new TextBeeAdapter(fakeConfig());
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: '' });

    expect(result).toEqual({ outcome: 'rejected', reason: 'message_too_long', retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails clearly without calling the network when no API key is configured', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const adapter = new TextBeeAdapter(fakeConfig({ TEXTBEE_API_KEY: '' }));
    const result = await adapter.send({ recipient: VALID_RECIPIENT, message: VALID_MESSAGE });

    expect(result).toEqual({
      outcome: 'rejected',
      reason: 'authentication_failed',
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
