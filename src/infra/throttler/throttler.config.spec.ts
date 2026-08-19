import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from '@jest/globals';
import type { EnvironmentVariables } from '@/config/env.validation';
import { createThrottlerOptions } from './throttler.config';

function createConfigService(overrides: Partial<EnvironmentVariables> = {}) {
  const values: Partial<EnvironmentVariables> = {
    THROTTLE_TTL: 60000,
    THROTTLE_LIMIT: 100,
    ...overrides,
  };

  return {
    get: (key: keyof EnvironmentVariables) => values[key],
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

describe('createThrottlerOptions', () => {
  it('builds a single default throttler from THROTTLE_TTL and THROTTLE_LIMIT', () => {
    const options = createThrottlerOptions(
      createConfigService({ THROTTLE_TTL: 30000, THROTTLE_LIMIT: 50 }),
    );

    expect(options).toEqual({
      throttlers: [{ name: 'default', ttl: 30000, limit: 50 }],
      errorMessage: expect.any(String),
    });
  });

  it('overrides the library default error message', () => {
    const options = createThrottlerOptions(createConfigService());

    expect(options).toMatchObject({
      errorMessage: expect.not.stringContaining('ThrottlerException'),
    });
  });
});

// To run it, use the following command:
// yarn test throttler.config
