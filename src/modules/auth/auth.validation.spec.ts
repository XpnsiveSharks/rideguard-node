import { GMAIL_PATTERN, PASSWORD_MIN_LENGTH, USERNAME_PATTERN } from './auth.validation';

describe('auth validation rules', () => {
  it('accepts Gmail addresses only', () => {
    expect(GMAIL_PATTERN.test('person@gmail.com')).toBe(true);
    expect(GMAIL_PATTERN.test('person@yahoo.com')).toBe(false);
  });

  it('accepts the documented username shape', () => {
    expect(USERNAME_PATTERN.test('rider.one_1')).toBe(true);
    expect(USERNAME_PATTERN.test('ab')).toBe(false);
    expect(USERNAME_PATTERN.test('rider-name')).toBe(false);
  });

  it('keeps the password minimum explicit', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
  });
});
