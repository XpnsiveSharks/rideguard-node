import {
  EMAIL_VERIFICATION_CODES_COLLECTION,
  REGISTRATION_PENDING_TTL_MS,
} from './registration.constants';

describe('registration verification constants', () => {
  it('uses the pending-account lifetime and email verification code collection', () => {
    expect(REGISTRATION_PENDING_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(EMAIL_VERIFICATION_CODES_COLLECTION).toBe('email_verification_codes');
  });
});
