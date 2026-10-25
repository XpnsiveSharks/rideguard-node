import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@/config/env.validation';
import { TextBeeAdapter } from './textbee.adapter';

const base = process.env.TEXTBEE_SIM_BASE_URL;
const suite = base ? describe : describe.skip;
suite('real TextBee HTTP adapter against isolated Postman provider simulation', () => {
  const control = async (path: string) => {
    if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/textbee$/.test(base))
      throw new Error('Local provider simulation required');
    const response = await fetch(`${base}/__test/${path}`);
    if (!response.ok) throw new Error('Fixture control failed');
    return response.json() as Promise<{ sends: number; checks: number; devices: string[] }>;
  };
  it('sends once, checks the saved device, distinguishes progress/errors, and never resends', async () => {
    const values = {
      TEXTBEE_BASE_URL: base,
      TEXTBEE_API_KEY: 'local-fixture',
      TEXTBEE_DEVICE_ID: 'original-device',
      TEXTBEE_TIMEOUT_MS: 200,
    };
    const config = {
      get: (key: string) => values[key as keyof typeof values],
    } as unknown as ConfigService<EnvironmentVariables, true>;
    const adapter = new TextBeeAdapter(config);
    await control('reset');
    const sent = await adapter.send({
      recipient: '+639111111111',
      message: 'Isolated test fixture',
    });
    expect(sent).toMatchObject({
      outcome: 'accepted',
      providerMessageId: 'fixture-batch-1',
      deviceId: 'original-device',
    });
    if (sent.outcome !== 'accepted') throw new Error('Fixture acceptance required');
    values.TEXTBEE_DEVICE_ID = 'changed-default';
    for (const state of ['pending', 'sent', 'delivered', 'failed']) {
      await control(`mode?value=${state}`);
      expect(await adapter.getStatus(sent.providerMessageId!, sent.deviceId)).toMatchObject({
        state,
      });
    }
    for (const reason of [
      'provider_unknown',
      'authentication_failed',
      'not_found',
      'rate_limited',
      'server_error',
      'malformed_response',
      'timeout',
    ]) {
      await control(`mode?value=${reason === 'provider_unknown' ? 'delivery_failed' : reason}`);
      const result = await adapter.getStatus(sent.providerMessageId!, sent.deviceId);
      expect(result).toMatchObject({ state: 'unknown', reason });
      if (reason === 'rate_limited') expect(result).toMatchObject({ retryAfterMs: 17000 });
    }
    const stats = await control('counts');
    expect(stats.sends).toBe(1);
    expect(stats.checks).toBe(11);
    expect(stats.devices.every((id) => id === 'original-device')).toBe(true);
  });
});
