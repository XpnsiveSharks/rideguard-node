import * as Joi from 'joi';
// VALID NODE_ENVIRONMENTS
export const NODE_ENVIRONMENTS = ['local', 'development', 'staging', 'production'] as const;

export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

export interface EnvironmentVariables {
  NODE_ENV: NodeEnvironment;
  PORT: number;
  API_VERSION: string;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_CLIENT_EMAIL: string;
  FIREBASE_PRIVATE_KEY: string;
}

export const envValidationSchema = Joi.object<EnvironmentVariables, true>({
  NODE_ENV: Joi.string()
    .valid(...NODE_ENVIRONMENTS)
    .default('local'),
  PORT: Joi.number().port().default(5565),
  API_VERSION: Joi.string().default('1'),

  FIREBASE_PROJECT_ID: Joi.string().required(),
  FIREBASE_CLIENT_EMAIL: Joi.string().email().required(),
  FIREBASE_PRIVATE_KEY: Joi.string()
    .required()
    .pattern(/-----BEGIN PRIVATE KEY-----/)
    .message('FIREBASE_PRIVATE_KEY must be a PEM-encoded private key'),
});
