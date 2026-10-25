import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@/config/env.validation';
import { TextBeeAdapter } from './textbee.adapter';

function fakeConfig(
  overrides: Partial<EnvironmentVariables> = {},
): ConfigService<EnvironmentVariables, true> {
  const values: Partial<EnvironmentVariables> = {
    TEXTBEE_BASE_URL: 'https://api.textbee.dev',
    TEXTBEE_API_KEY: 'a-configured-key',
    TEXTBEE_DEVICE_ID: 'device-1',
    TEXTBEE_TIMEOUT_MS: 5000,
    ...overrides,
  };
  return {
    get: jest.fn((key: keyof EnvironmentVariables) => values[key]),
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status });

const statusBody = (
  messageStatus: string,
  extra: Record<string, unknown> = {},
  batch = 'failed',
) => ({
  batch: { status: batch },
  messages: [{ status: messageStatus, ...extra }],
});

describe('TextBeeAdapter.getStatus', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it.each(['unknown', 'delivery_failed'])('treats %s as recognized uncertainty even with a completed batch', async status => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, statusBody(status, {}, 'completed')));
    expect(await new TextBeeAdapter(fakeConfig()).getStatus('batch')).toEqual({ state: 'unknown', reason: 'provider_unknown' });
  });
  it('uses the saved sending device instead of the current default', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(200, statusBody('sent'))); global.fetch = fetchMock;
    await new TextBeeAdapter(fakeConfig({ TEXTBEE_DEVICE_ID: 'new-device' })).getStatus('batch', 'old-device');
    expect(fetchMock.mock.calls[0][0]).toContain('/old-device/sms-batch/batch');
  });
  it('honors numeric and HTTP-date Retry-After, with a 60s fallback', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-25T00:00:00Z'));
    for (const [header, delay] of [['12', 12000], ['Sun, 25 Oct 2026 00:00:45 GMT', 45000], ['invalid', 60000]] as const) {
      global.fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': header } }));
      expect(await new TextBeeAdapter(fakeConfig()).getStatus('batch')).toEqual({ state: 'unknown', reason: 'rate_limited', retryAfterMs: delay });
    }
  });

  it('calls the documented per-device batch route with the api key', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(200, statusBody('delivered')));
    global.fetch = fetchMock;

    await new TextBeeAdapter(fakeConfig()).getStatus('batch-123');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.textbee.dev/api/v1/gateway/devices/device-1/sms-batch/batch-123');
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ 'x-api-key': 'a-configured-key' });
  });

  it.each([
    ['pending', { state: 'pending' }],
    ['processing', { state: 'pending' }],
    ['dispatched', { state: 'pending' }],
    ['sent', { state: 'sent' }],
    ['delivered', { state: 'delivered' }],
  ])('maps message status %s', async (status, expected) => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, statusBody(status)));
    await expect(new TextBeeAdapter(fakeConfig()).getStatus('b')).resolves.toEqual(expected);
  });

  it('maps failed with the provider errorCode only, never its message', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(
          200,
          statusBody('failed', { errorCode: '4', errorMessage: 'No cellular service.' }),
        ),
      );
    await expect(new TextBeeAdapter(fakeConfig()).getStatus('b')).resolves.toEqual({
      state: 'failed',
      errorCode: '4',
    });
  });

  it('stringifies a numeric errorCode and tolerates a missing one', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, statusBody('failed', { errorCode: 111 })))
      .mockResolvedValueOnce(jsonResponse(200, statusBody('failed')));
    const adapter = new TextBeeAdapter(fakeConfig());
    await expect(adapter.getStatus('b')).resolves.toEqual({ state: 'failed', errorCode: '111' });
    await expect(adapter.getStatus('b')).resolves.toEqual({ state: 'failed' });
  });

  it('reads a body nested under data', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { data: statusBody('delivered') }));
    await expect(new TextBeeAdapter(fakeConfig()).getStatus('b')).resolves.toEqual({
      state: 'delivered',
    });
  });

  it('falls back to the batch status and claims only "sent" for completed', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { batch: { status: 'completed' }, messages: [] }));
    await expect(new TextBeeAdapter(fakeConfig()).getStatus('b')).resolves.toEqual({
      state: 'sent',
    });
  });

  it.each([
    [401, 'authentication_failed'],
    [403, 'authentication_failed'],
    [404, 'not_found'],
    [500, 'server_error'],
    [503, 'server_error'],
  ])('maps HTTP %i to unknown/%s', async (status, reason) => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(status, { error: 'x' }));
    await expect(new TextBeeAdapter(fakeConfig()).getStatus('b')).resolves.toEqual({
      state: 'unknown',
      reason,
    });
  });

  it.each([
    ['unrecognized status', jsonResponse(200, statusBody('mystery'))],
    ['partial_success batch only', jsonResponse(200, { batch: { status: 'partial_success' } })],
    ['non-JSON body', new Response('<html>', { status: 200 })],
    ['empty object', jsonResponse(200, {})],
  ])('treats %s as malformed_response', async (_label, response) => {
    global.fetch = jest.fn().mockResolvedValue(response);
    await expect(new TextBeeAdapter(fakeConfig()).getStatus('b')).resolves.toEqual({
      state: 'unknown',
      reason: 'malformed_response',
    });
  });

  it('reports timeout on AbortError and network_error otherwise', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(abort)
      .mockRejectedValueOnce(new Error('ECONNRESET'));
    const adapter = new TextBeeAdapter(fakeConfig());
    await expect(adapter.getStatus('b')).resolves.toEqual({ state: 'unknown', reason: 'timeout' });
    await expect(adapter.getStatus('b')).resolves.toEqual({
      state: 'unknown',
      reason: 'network_error',
    });
  });

  it.each([{ TEXTBEE_API_KEY: '' }, { TEXTBEE_DEVICE_ID: '' }])(
    'makes no network call when config is missing (%o)',
    async (override) => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock;
      await expect(new TextBeeAdapter(fakeConfig(override)).getStatus('b')).resolves.toEqual({
        state: 'unknown',
        reason: 'not_configured',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
