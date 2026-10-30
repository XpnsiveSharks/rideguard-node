export const REGISTRATION_PENDING_COLLECTION = 'pending_registrations';
export const REGISTRATION_PENDING_TTL_MS = 24 * 60 * 60 * 1000;

/** Firestore collection for registration email verification codes (keyed by uid). */
export const EMAIL_VERIFICATION_CODES_COLLECTION = 'email_verification_codes';
