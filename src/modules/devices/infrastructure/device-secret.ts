import { randomBytes } from 'node:crypto';

const DEVICE_SECRET_BYTE_LENGTH = 32;

// Generates a unique secret for an ESP32 device during registration.
export function generateDeviceSecret(): string {
  return randomBytes(DEVICE_SECRET_BYTE_LENGTH).toString('base64url');
}
