import * as Joi from 'joi';
// VALID NODE_ENVIRONMENTS
export const NODE_ENVIRONMENTS = ['local', 'development', 'staging', 'production'] as const;

export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

export interface EnvironmentVariables {
  NODE_ENV: NodeEnvironment;
  PORT: number;
  API_VERSION: string;
  CORS_ORIGINS: string;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_CLIENT_EMAIL: string;
  FIREBASE_PRIVATE_KEY: string;
  FIREBASE_WEB_API_KEY: string;
  FIREBASE_AUTH_API_BASE_URL: string;
  CLOUDINARY_CLOUD_NAME: string;
  CLOUDINARY_API_KEY: string;
  CLOUDINARY_API_SECRET: string;
  ABLY_API_KEY: string;
  DEVICE_ABLY_ISSUER_API_KEY: string;
  UPSTREAM_ABLY_API_KEY: string;
  DEVICE_RESOLVER_SERVICE_KEY: string;
  PHONE_SESSION_MAX_DURATION_MS: number;
  THROTTLE_TTL: number;
  THROTTLE_LIMIT: number;
  AUTO_ARCHIVE_ENABLED: boolean;
  SOS_ENABLED: boolean;
  SMS_API_PH_BASE_URL: string;
  SMS_API_PH_API_KEY: string;
  SMS_API_PH_TIMEOUT_MS: number;
  TEXTBEE_BASE_URL: string;
  TEXTBEE_API_KEY: string;
  TEXTBEE_DEVICE_ID: string;
  TEXTBEE_TIMEOUT_MS: number;
}

const ABLY_API_KEY_PATTERN = /^[\w-]+\.[\w-]+:[\w=-]+$/;

export const envValidationSchema = Joi.object<EnvironmentVariables, true>({
  NODE_ENV: Joi.string()
    .valid(...NODE_ENVIRONMENTS)
    .default('local'),
  PORT: Joi.number().port().default(5565),
  API_VERSION: Joi.string().default('1'),

  CORS_ORIGINS: Joi.string()
    .default('*')
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().required().invalid('*'),
    }),

  FIREBASE_PROJECT_ID: Joi.string().required(),
  FIREBASE_CLIENT_EMAIL: Joi.string().email().required(),
  FIREBASE_PRIVATE_KEY: Joi.string()
    .required()
    .pattern(/-----BEGIN PRIVATE KEY-----/)
    .message('FIREBASE_PRIVATE_KEY must be a PEM-encoded private key'),
  FIREBASE_WEB_API_KEY: Joi.string().required(),
  FIREBASE_AUTH_API_BASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default('https://identitytoolkit.googleapis.com/v1'),
  CLOUDINARY_CLOUD_NAME: Joi.string().required(),
  CLOUDINARY_API_KEY: Joi.string().required(),
  CLOUDINARY_API_SECRET: Joi.string().required(),

  ABLY_API_KEY: Joi.string()
    .required()
    .pattern(ABLY_API_KEY_PATTERN)
    .message('ABLY_API_KEY must look like appId.keyId:keySecret'),

  UPSTREAM_ABLY_API_KEY: Joi.string()
    .required()
    .pattern(ABLY_API_KEY_PATTERN)
    .message('UPSTREAM_ABLY_API_KEY must look like appId.keyId:keySecret'),

  DEVICE_ABLY_ISSUER_API_KEY: Joi.string()
    .required()
    .pattern(ABLY_API_KEY_PATTERN)
    .message('DEVICE_ABLY_ISSUER_API_KEY must look like appId.keyId:keySecret'),

  // Shared secret the model-api sends as X-Service-Key to resolve a button's
  // cameras. Not an Ably key, so it has no key-shape pattern.
  DEVICE_RESOLVER_SERVICE_KEY: Joi.string().required().min(16),

  // Longest phone capture session the server accepts. Matches the app's
  // PHONE_CAPTURE_SESSION_DURATION_MS by default.
  PHONE_SESSION_MAX_DURATION_MS: Joi.number().integer().min(60000).default(600000),

  THROTTLE_TTL: Joi.number().integer().positive().default(60000), // Default length in milliseconds
  THROTTLE_LIMIT: Joi.number().integer().positive().default(100), // Default max requests a single client gets within that window.

  // Gates the background auto-archive pass. Kept off until existing alerts are
  // backfilled with createdAt/isArchived and the composite indexes are built.
  AUTO_ARCHIVE_ENABLED: Joi.boolean().default(false),

  // Gates manual SOS activation (POST /sos). Off until release checks pass;
  // reading and stopping an existing SOS keep working when it is off.
  SOS_ENABLED: Joi.boolean().default(false),

  // SMS API PH (see docs/unimplemented-features/replaceable-sms-provider.md).
  // No caller exists yet, so the key is not required to boot the app; the
  // adapter fails clearly at send time instead if it is missing.
  SMS_API_PH_BASE_URL: Joi.string().uri().default('https://smsapiph.onrender.com'),
  SMS_API_PH_API_KEY: Joi.string().allow('').default(''),
  SMS_API_PH_TIMEOUT_MS: Joi.number().integer().positive().default(10000),

  // TextBee (see docs/unimplemented-features/replaceable-sms-provider.md).
  // Relays sends through a paired Android phone's own SIM. No caller exists
  // yet, so the key is not required to boot the app; the adapter fails
  // clearly at send time instead if it is missing.
  TEXTBEE_BASE_URL: Joi.string().uri().default('https://api.textbee.dev'),
  TEXTBEE_API_KEY: Joi.string().allow('').default(''),
  // Optional: pins sends to one paired device. Omitted from the request
  // entirely when unset so TextBee picks its own default device.
  TEXTBEE_DEVICE_ID: Joi.string().allow('').default(''),
  TEXTBEE_TIMEOUT_MS: Joi.number().integer().positive().default(10000),
});
