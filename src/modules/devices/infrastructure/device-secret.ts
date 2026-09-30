import { createHash, randomBytes } from 'node:crypto';

const DEVICE_SECRET_BYTE_LENGTH = 32;

// Generates a unique secret for an ESP32(button) device during registration.
export function generateDeviceSecret(): string {
  return randomBytes(DEVICE_SECRET_BYTE_LENGTH).toString('base64url');
}

// Hashes a device secret with SHA-256 so only the hash is stored, not the raw secret.
export function hashDeviceSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}
