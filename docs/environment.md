# Environment Variables

This project reads environment variables through NestJS `ConfigService`.

Create a local `.env` file by copying the example file:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

## Required Variables

| Name | Type | Example | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | `local`, `development`, `staging`, or `production` | `local` | Controls environment-specific behavior. Defaults to `local`. |
| `PORT` | number | `5565` | Port used by the HTTP server. Defaults to `5565`. |
| `API_VERSION` | string | `1` | Default URI API version, used as `/v1`. Defaults to `1`. |
| `CORS_ORIGINS` | comma-separated string | `https://app.rideguard.com,https://admin.rideguard.com` | Origins allowed by CORS. Defaults to `*` outside production. Production must list origins explicitly and is rejected if set to `*`. |
| `FIREBASE_PROJECT_ID` | string | `rideguard-dev` | Firebase project ID from the service account. |
| `FIREBASE_CLIENT_EMAIL` | email string | `firebase-adminsdk-...@...iam.gserviceaccount.com` | Firebase service account client email. |
| `FIREBASE_PRIVATE_KEY` | string | `"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"` | Firebase service account private key. Keep the escaped `\n` characters in `.env`. |

## How Validation Works

Environment variables are defined in `src/config/env.validation.ts` in two places.

The `EnvironmentVariables` interface tells TypeScript what variables exist and what type each value should have when using `ConfigService`:

```ts
export interface EnvironmentVariables {
  NODE_ENV: NodeEnvironment;
  PORT: number;
  API_VERSION: string;
  CORS_ORIGINS: string;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_CLIENT_EMAIL: string;
  FIREBASE_PRIVATE_KEY: string;
}
```

The Joi schema validates the actual `.env` values when the app starts:

```ts
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
});
```

## Adding A New Variable

When you add a new environment variable, update all three places:

1. Add it to `.env.example`.
2. Add it to the `EnvironmentVariables` interface.
3. Add it to `envValidationSchema`.

Steps 2 and 3 are enforced by the compiler. The schema is declared as
`Joi.object<EnvironmentVariables, true>`, so adding a variable to one without
the other fails the build.

Example:

```env
PAYMENT_SECRET_KEY=replace-me
```

```ts
export interface EnvironmentVariables {
  // existing variables...
  PAYMENT_SECRET_KEY: string;
}
```

```ts
export const envValidationSchema = Joi.object<EnvironmentVariables, true>({
  // existing validation...
  PAYMENT_SECRET_KEY: Joi.string().required(),
});
```

After that, use it with `ConfigService`:

```ts
const paymentSecretKey = configService.get('PAYMENT_SECRET_KEY', { infer: true });
```

## Firebase Private Key Format

Keep the Firebase private key as one quoted line in `.env` and use escaped newlines:

```env
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nPRIVATE_KEY_CONTENT\n-----END PRIVATE KEY-----\n"
```

The Firebase provider converts those escaped `\n` values into real newlines before initializing Firebase.

## CORS Origins

`CORS_ORIGINS` affects browser clients only.

The RideGuard mobile app (`com.rideguard.app`) is a native build. It sends no
`Origin` header and ignores `Access-Control-Allow-Origin`, so CORS neither
restricts nor protects it - an application ID is not a web origin and must
never be added to this variable. Requests from the app are authorized by the
Firebase ID token check in `FirebaseAuthGuard`.

List only browser origins here: the admin dashboard, plus its dev server while
working locally.

```env
# local - the default already allows everything
CORS_ORIGINS=*

# production - must be explicit, * is rejected at startup
CORS_ORIGINS=https://admin.rideguard.com
```

The value is one string, split on commas in `main.ts`. Surrounding spaces are
trimmed, so `a.com, b.com` is fine.
