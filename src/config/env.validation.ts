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
  THROTTLE_TTL: number;
  THROTTLE_LIMIT: number;
}

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

  // Rate limiting (see infra/throttler). Window length in milliseconds, and
  // the max requests a single client gets within that window.
  THROTTLE_TTL: Joi.number().integer().positive().default(60000),
  THROTTLE_LIMIT: Joi.number().integer().positive().default(100),
});
