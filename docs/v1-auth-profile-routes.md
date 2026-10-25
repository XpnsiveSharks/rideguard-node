# V1 Routes

These routes use URI versioning. With the default `API_VERSION=1`, every path
below is mounted under `/v1`.

Default local base URL:

```text
http://localhost:5565/v1
```

## Shared Behavior

Protected routes require a Firebase ID token because `FirebaseAuthGuard` is
registered globally. The credential routes below are public.

```http
Authorization: Bearer <firebase-id-token>
```

## POST /v1/auth/register

Creates an unverified Firebase email/password user and sends a Firebase
verification link through the configured email transport. No RideGuard profile
is created until verification.

```json
{
  "username": "jane.driver",
  "email": "jane@gmail.com",
  "password": "Password1"
}
```

Returns `202` with `{ "email": "jane@gmail.com" }` in `data`. Usernames are
case-insensitive, 3–24 characters, and use only letters, numbers, periods, or
underscores. Gmail is required. Passwords need at least eight characters, one
letter, and one number.

## POST /v1/auth/login

Accepts `{ "identifier": "jane.driver", "password": "Password1" }`. The
identifier can be a username or email. Success returns `200` with the Firebase
`uid` and email in `data`. Wrong credentials always return the same `401`
message.

## POST /v1/auth/register/verify

The client applies the Firebase verification link, refreshes the Firebase user,
and sends its fresh verified ID token in `Authorization: Bearer <id-token>`.
There is no request body. The endpoint returns `200` with `{ uid, email }` in
`data` and creates the RideGuard profile.

## POST /v1/auth/forgot-password

Accepts `{ "email": "jane@gmail.com" }` and returns `200` with the same generic
message whether the account exists or not. It is rate-limited by IP and email.

Firebase sends the password-reset link. The client or Firebase-hosted handler
applies that link and sets the new password. RideGuard has no reset OTP or
password-reset action-code endpoint.

## GET /v1/auth/me

Returns user identity fields from the verified Firebase ID token.

### Request

No request body.

### Success Response

Message: `User profile retrieved successfully`

```json
{
  "success": true,
  "message": "User profile retrieved successfully",
  "data": {
    "uid": "firebase-user-id",
    "email": "user@example.com",
    "emailVerified": true,
    "name": "Jane Driver",
    "picture": "https://example.com/profile.jpg"
  },
  "timestamp": "2026-08-25T00:00:00.000Z"
}
```

### Errors

| Status | Reason                                      |
| ------ | ------------------------------------------- |
| `401`  | Missing or invalid Firebase bearer token.   |
| `429`  | Request exceeded the global throttle limit. |

## GET /v1/auth/is-old-user

Returns `true` when the user has a profile.

### Request

No request body.

### Success Response

```json
{
  "success": true,
  "message": "User status retrieved successfully",
  "data": true,
  "timestamp": "2026-08-30T14:13:11.547Z"
}
```

### Errors

| Status | Reason                                      |
| ------ | ------------------------------------------- |
| `401`  | Missing or invalid Firebase bearer token.   |
| `429`  | Request exceeded the global throttle limit. |

## GET /v1/auth/ably-token

Creates an Ably token request for the signed-in user. The request allows
subscribe access to that user's alerts and the shared button event channel.

### Errors

| Status | Reason                                    |
| ------ | ----------------------------------------- |
| `401`  | Missing or invalid Firebase bearer token. |
| `429`  | Request exceeded the global throttle limit. |

## POST /v1/auth/delete-account

Schedules the authenticated user's account for deletion after the configured
grace period. Requires the user's current account password. During the grace
period, normal authenticated access is blocked, but deletion status and
cancellation remain accessible.

### Request Body

| Field      | Type   | Required | Notes                                    |
| ---------- | ------ | -------- | ---------------------------------------- |
| `password` | string | Yes      | Current account password to authenticate |

```json
{
  "password": "Password1"
}
```

### Success Response (200)

```json
{
  "success": true,
  "message": "Account deletion scheduled successfully",
  "data": {
    "scheduled": true,
    "deletionScheduledAt": "2026-11-24T16:00:00.000Z"
  },
  "timestamp": "2026-10-25T16:00:00.000Z"
}
```

### Errors

| Status | Reason                                    |
| ------ | ----------------------------------------- |
| `400`  | Validation failed (missing password).     |
| `401`  | Missing token, invalid token, or wrong password. |
| `429`  | Request exceeded the throttle limit.      |

## POST /v1/auth/delete-account/cancel

Cancels a pending account deletion request within the grace period window,
clearing the scheduled deletion flag and re-enabling the user account.

### Request

No request body. Requires `Authorization: Bearer <token>`.

### Success Response (200)

```json
{
  "success": true,
  "message": "Account deletion cancelled successfully",
  "data": {
    "scheduled": false
  },
  "timestamp": "2026-10-25T16:00:00.000Z"
}
```

### Errors

| Status | Reason                                    |
| ------ | ----------------------------------------- |
| `401`  | Missing or invalid Firebase bearer token. |
| `429`  | Request exceeded the throttle limit.      |

## GET /v1/auth/delete-account/status

Returns the current account deletion status and scheduled deletion timestamp (if active)
for the authenticated user. Accessible even while account deletion is pending.

### Request

No request body. Requires `Authorization: Bearer <token>`.

### Success Response (200)

When scheduled:

```json
{
  "success": true,
  "message": "Account deletion status retrieved successfully",
  "data": {
    "scheduled": true,
    "deletionScheduledAt": "2026-11-24T16:00:00.000Z"
  },
  "timestamp": "2026-10-25T16:00:00.000Z"
}
```

When not scheduled:

```json
{
  "success": true,
  "message": "Account deletion status retrieved successfully",
  "data": {
    "scheduled": false,
    "deletionScheduledAt": null
  },
  "timestamp": "2026-10-25T16:00:00.000Z"
}
```

### Errors

| Status | Reason                                    |
| ------ | ----------------------------------------- |
| `401`  | Missing or invalid Firebase bearer token. |
| `429`  | Request exceeded the throttle limit.      |

## POST /v1/profile/personal-info

Creates a profile document for the authenticated Firebase user. The user ID,
email, and profile image URL come from the verified Firebase token.

### Request Body

| Field                    | Type   | Required | Notes                                                           |
| ------------------------ | ------ | -------- | --------------------------------------------------------------- |
| `first_name`             | string | Yes      | Must be a non-empty string after trimming.                      |
| `last_name`              | string | Yes      | Must be a non-empty string after trimming.                      |
| `phone_number`           | string | Yes      | Must be a non-empty string after trimming.                      |
| `brand`                  | string | Yes      | Vehicle brand; must be non-empty after trimming.                |
| `model`                  | string | Yes      | Vehicle model; must be non-empty after trimming.                |
| `plate_number`           | string | Yes      | Vehicle plate number; must be non-empty after trimming.         |
| `color`                  | string | Yes      | Vehicle color; must be non-empty after trimming.                |
| `contact_name`           | string | No       | Emergency contact name.                                         |
| `emergency_phone_number` | string | No       | Emergency contact phone number.                                 |
| `relationship`           | string | No       | Must be one of the supported relationship values when provided. |

Supported `relationship` values:

```text
Parent
Child
Sibling
Spouse
Partner
Friend
Colleague
Mentor
Student
Other
```

Example:

```json
{
  "first_name": "Jane",
  "last_name": "Driver",
  "phone_number": "+15555550100",
  "brand": "Honda",
  "model": "Click 125",
  "plate_number": "ABC 1234",
  "color": "Red",
  "contact_name": "Alex Driver",
  "emergency_phone_number": "+15555550199",
  "relationship": "Sibling"
}
```

### Success Response

The controller returns no payload, so the response envelope contains an empty
`data` object.

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {},
  "timestamp": "2026-08-25T00:00:00.000Z"
}
```

### Errors

| Status | Reason                                                                                      |
| ------ | ------------------------------------------------------------------------------------------- |
| `400`  | Request validation failed, required fields are blank, or `relationship` is unsupported.     |
| `401`  | Missing or invalid Firebase bearer token, or the verified token does not provide a user ID. |
| `422`  | A profile already exists for the authenticated user.                                        |
| `429`  | Request exceeded the global throttle limit.                                                 |

Validation error example:

```json
{
  "success": false,
  "message": "Validation failed",
  "statusCode": 400,
  "timestamp": "2026-08-25T00:00:00.000Z",
  "fields": {
    "first_name": "first_name must be a string"
  }
}
```

## PATCH /v1/profile/me

Updates editable profile fields for the authenticated user. The server derives
the profile document ID from the verified Firebase ID token; a client-supplied
UID is never accepted.

Editable JSON fields are optional: `first_name`, `last_name`, `phone_number`,
`brand`, `model`, `plate_number`, and `color`. Names and vehicle fields are
trimmed non-blank strings (maximum 80 characters for names/brand/model and 40
for plate/color). Phone numbers use the international format `+` followed by
8–15 digits (the leading `+` is optional). At least one field must be supplied
by the caller's request; unknown fields are rejected by the global validation
pipe.

Email is read-only, and `uid`, `role`, verification flags, and other protected
fields are not editable. The Firebase account email is never modified. Phone
updates currently do not require a confirmation code. The planned
account-bound, expiring phone confirmation challenge is intentionally disabled
in `ProfileService` until an email/SMS delivery service is available.

Success returns the updated profile in `data`. Invalid fields return `400` with
the standard `Validation failed`/`fields` shape; missing or invalid Firebase
credentials return `401`.

## POST /v1/profile/emergency-contact

Creates or updates emergency contact info for the authenticated Firebase user.

### Request Body

| Field                    | Type   | Required | Notes                                                           |
| ------------------------ | ------ | -------- | --------------------------------------------------------------- |
| `contact_name`           | string | No       | Emergency contact name.                                         |
| `emergency_phone_number` | string | No       | Emergency contact phone number.                                 |
| `relationship`           | string | No       | Must be one of the supported relationship values when provided. |

Supported `relationship` values:

```text
Parent
Child
Sibling
Spouse
Partner
Friend
Colleague
Mentor
Student
Other
```

Example:

```json
{
  "contact_name": "Alex Driver",
  "emergency_phone_number": "+15555550199",
  "relationship": "Sibling"
}
```

### Success Response

The controller returns no payload, so the response envelope contains an empty
`data` object.

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {},
  "timestamp": "2026-08-25T00:00:00.000Z"
}
```

### Errors

| Status | Reason                                                                                      |
| ------ | ------------------------------------------------------------------------------------------- |
| `400`  | Request validation failed or `relationship` is unsupported.                                 |
| `401`  | Missing or invalid Firebase bearer token, or the verified token does not provide a user ID. |
| `429`  | Request exceeded the global throttle limit.                                                 |


## MPIN Routes

The MPIN system provides an authenticated secondary 4-digit PIN for sensitive in-app operations, unlock gating, and account protection. All MPIN routes require a verified Firebase ID token (`Authorization: Bearer <token>`).

### Security Architecture

- **Hashing**: Scrypt algorithm with 16-byte random salt and 64-byte derived key (`scrypt$<salt>$<hash>`). Verification uses constant-time `timingSafeEqual`.
- **PIN Length**: Exactly 4 numeric digits (`^\d{4}$`).
- **Lockout Policy**: 5 consecutive failed PIN attempts trigger a 15-minute lockout (`MPIN_LOCK_MS = 900,000 ms`). During lockout, attempts return `429 Too Many Requests` with `{ message: "MPIN is locked", retryAt: <unix-ms> }`.
- **Unlock Lifetime**: A successful unlock remains valid for 15 minutes (`MPIN_UNLOCK_MS = 900,000 ms`).
- **Grants & Challenges**: Single-use tokens bound to user ID, purpose, and 10-minute expiry (`MPIN_GRANT_MS = 600,000 ms`, `MPIN_CODE_MS = 600,000 ms`). Replay attempts are rejected with `401 Unauthorized`.
- **Code Limits**: 6-digit email challenges allow up to 5 verification attempts (`MPIN_CODE_ATTEMPT_LIMIT = 5`). Resend requires waiting at least 60 seconds (`MPIN_RESEND_MS = 60,000 ms`). A resend marks previous active challenges as replaced.
- **Rollout Status**: Frontend adapter `mpinApi.enabled` remains `false` until all error mappings and external email transports are connected.

---

### GET /v1/mpin/status

Returns current MPIN configuration, unlock status, remaining attempts, and lockout info.

#### Query Parameters (Optional)

| Parameter       | Type   | Description                                   |
| --------------- | ------ | --------------------------------------------- |
| `reason`        | string | Optional context: `'launch'`, `'resume'`, or `'expiry'`. |
| `inactiveForMs` | number | Optional observed client inactivity duration. |

#### Success Response (200)

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {
    "configured": true,
    "requiresUnlock": false,
    "locked": false,
    "remainingAttempts": 5,
    "unlockExpiresAt": 1729605600000,
    "serverTime": 1729604700000,
    "emergencyAccessAllowed": false,
    "emergencyAlertIds": []
  },
  "timestamp": "2026-10-22T10:00:00.000Z"
}
```

*When locked, `locked: true`, `remainingAttempts: 0`, and `lockedUntil: <unix-ms>` are returned.*

#### Errors

| Status | Reason                                              |
| ------ | --------------------------------------------------- |
| `401`  | Missing or invalid Firebase ID token.               |
| `429`  | Rate limit exceeded.                                |

---

### POST /v1/mpin/setup

Configures a new 4-digit MPIN for the authenticated user. Rejects duplicate setup.

#### Request Body

```json
{
  "pin": "1234"
}
```

#### Success Response (201 / 200)

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {
    "success": true
  },
  "timestamp": "2026-10-22T10:00:00.000Z"
}
```

#### Errors

| Status | Reason                                              |
| ------ | --------------------------------------------------- |
| `400`  | Validation failed (PIN is not exactly 4 digits).    |
| `401`  | Missing or invalid Firebase bearer token.           |
| `409`  | MPIN is already configured.                         |

---

### POST /v1/mpin/unlock

Verifies the user's 4-digit MPIN and establishes a 15-minute unlock window.

#### Request Body

```json
{
  "pin": "1234"
}
```

#### Success Response (200)

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {
    "success": true
  },
  "timestamp": "2026-10-22T10:00:00.000Z"
}
```

#### Errors

| Status | Reason                                                                   |
| ------ | ------------------------------------------------------------------------ |
| `400`  | MPIN is not configured or PIN format is invalid.                         |
| `401`  | Incorrect MPIN (increments failed attempts).                             |
| `429`  | MPIN is locked due to 5 consecutive failures (`retryAt` timestamp sent). |

---

### POST /v1/mpin/change/authorize

Verifies the existing MPIN prior to initiating a PIN change, returning a short-lived `change-proof` grant token. Subject to attempt limits and lockout.

#### Request Body

```json
{
  "pin": "1234"
}
```

#### Success Response (200)

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {
    "token": "base64url-grant-token",
    "expiresAt": 1729605300000,
    "serverTime": 1729604700000
  },
  "timestamp": "2026-10-22T10:00:00.000Z"
}
```

#### Errors

| Status | Reason                                              |
| ------ | --------------------------------------------------- |
| `400`  | MPIN is not configured or PIN format is invalid.    |
| `401`  | Incorrect MPIN.                                     |
| `429`  | Account is locked due to too many failed attempts.  |

---

### POST /v1/mpin/change/code

Consumes the `change-proof` authorization token and dispatches a 6-digit verification code to the account's registered email.

#### Request Body

```json
{
  "authorization": "base64url-grant-token"
}
```
*(Accepts either `"authorization"` or `"currentPinProof"`)*

#### Success Response (200)

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {
    "challengeId": "36-hex-challenge-id",
    "maskedDestination": "u***@gmail.com",
    "expiresAt": 1729605300000,
    "resendAt": 1729604760000,
    "serverTime": 1729604700000
  },
  "timestamp": "2026-10-22T10:00:00.000Z"
}
```

#### Errors

| Status | Reason                                                                 |
| ------ | ---------------------------------------------------------------------- |
| `400`  | Missing authorization token.                                           |
| `401`  | Invalid, expired, or already-consumed authorization grant.            |
| `403`  | Registered email verification is required.                             |
| `503`  | MPIN email delivery is not configured.                                 |

---

### POST /v1/mpin/change/code/resend

Resends an active change code after the 60-second cooldown has passed. Marks previous code as replaced.

#### Request Body

```json
{
  "challengeId": "36-hex-challenge-id"
}
```

#### Success Response (200)

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {
    "challengeId": "new-36-hex-challenge-id",
    "maskedDestination": "u***@gmail.com",
    "expiresAt": 1729605300000,
    "resendAt": 1729604760000,
    "serverTime": 1729604700000
  },
  "timestamp": "2026-10-22T10:00:00.000Z"
}
```

#### Errors

| Status | Reason                                              |
| ------ | --------------------------------------------------- |
| `400`  | Invalid, used, or replaced challenge.               |
| `429`  | Code cannot be resent yet (cooldown active).        |
| `503`  | MPIN email delivery is not configured.              |

---

### POST /v1/mpin/change/code/verify

Verifies the 6-digit email code and returns a single-use `change` grant.

#### Request Body

```json
{
  "challengeId": "36-hex-challenge-id",
  "code": "123456"
}
```

#### Success Response (200)

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {
    "token": "base64url-change-grant-token",
    "expiresAt": 1729605300000,
    "serverTime": 1729604700000
  },
  "timestamp": "2026-10-22T10:00:00.000Z"
}
```

#### Errors

| Status | Reason                                                                   |
| ------ | ------------------------------------------------------------------------ |
| `400`  | Invalid challenge ID or code format.                                     |
| `401`  | Invalid or expired code (increments attempt counter).                   |
| `429`  | Too many code attempts (maximum 5 attempts reached).                     |

---

### POST /v1/mpin/change

Consumes the verified `change` grant and updates the account's MPIN. Clears any active unlock window or lockout.

#### Request Body

```json
{
  "authorization": "base64url-change-grant-token",
  "pin": "5678"
}
```

#### Success Response (200)

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {
    "success": true
  },
  "timestamp": "2026-10-22T10:00:00.000Z"
}
```

#### Errors

| Status | Reason                                                              |
| ------ | ------------------------------------------------------------------- |
| `400`  | Invalid PIN format (must be 4 digits).                              |
| `401`  | Invalid, expired, reused, or wrong-purpose authorization grant.     |

---

### POST /v1/mpin/recovery/code

Initiates MPIN recovery for the authenticated user by dispatching a 6-digit recovery code to the registered email.

#### Request Body

*None.*

#### Success Response (200)

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {
    "challengeId": "36-hex-challenge-id",
    "maskedDestination": "u***@gmail.com",
    "expiresAt": 1729605300000,
    "resendAt": 1729604760000,
    "serverTime": 1729604700000
  },
  "timestamp": "2026-10-22T10:00:00.000Z"
}
```

#### Errors

| Status | Reason                                              |
| ------ | --------------------------------------------------- |
| `401`  | Missing or invalid Firebase bearer token.           |
| `403`  | Registered email verification is required.          |
| `503`  | MPIN email delivery is not configured.              |

---

### POST /v1/mpin/recovery/code/resend

Resends the recovery code after the 60-second cooldown has passed.

#### Request Body

```json
{
  "challengeId": "36-hex-challenge-id"
}
```

#### Success Response (200)

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {
    "challengeId": "new-36-hex-challenge-id",
    "maskedDestination": "u***@gmail.com",
    "expiresAt": 1729605300000,
    "resendAt": 1729604760000,
    "serverTime": 1729604700000
  },
  "timestamp": "2026-10-22T10:00:00.000Z"
}
```

#### Errors

| Status | Reason                                              |
| ------ | --------------------------------------------------- |
| `400`  | Invalid, used, or replaced challenge.               |
| `429`  | Code cannot be resent yet.                          |
| `503`  | MPIN email delivery is not configured.              |

---

### POST /v1/mpin/recovery/code/verify

Verifies the 6-digit recovery code and issues a single-use `reset` grant token.

#### Request Body

```json
{
  "challengeId": "36-hex-challenge-id",
  "code": "123456"
}
```

#### Success Response (200)

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {
    "token": "base64url-reset-grant-token",
    "expiresAt": 1729605300000,
    "serverTime": 1729604700000
  },
  "timestamp": "2026-10-22T10:00:00.000Z"
}
```

#### Errors

| Status | Reason                                                                   |
| ------ | ------------------------------------------------------------------------ |
| `400`  | Invalid challenge ID or code format.                                     |
| `401`  | Invalid or expired code.                                                 |
| `429`  | Too many code attempts (limit of 5 attempts reached).                    |

---

### POST /v1/mpin/recovery/reset

Consumes the verified `reset` grant token to set a new 4-digit MPIN.

#### Request Body

```json
{
  "authorization": "base64url-reset-grant-token",
  "pin": "9876"
}
```

#### Success Response (200)

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {
    "success": true
  },
  "timestamp": "2026-10-22T10:00:00.000Z"
}
```

#### Errors

| Status | Reason                                                              |
| ------ | ------------------------------------------------------------------- |
| `400`  | Invalid PIN format (must be 4 digits).                              |
| `401`  | Invalid, expired, reused, or wrong-purpose authorization grant.     |
