export const USERNAME_PATTERN = /^[a-z0-9._]{3,24}$/;
export const GMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@gmail\.com$/i;
export const PASSWORD_MIN_LENGTH = 8;

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
