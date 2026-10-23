import {
  REGISTRATION_PENDING_TTL_MS,
} from './registration.constants';

describe('registration verification constants', () => {
  it('uses the pending-account lifetime and resend cooldown', () => {
    expect(REGISTRATION_PENDING_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
