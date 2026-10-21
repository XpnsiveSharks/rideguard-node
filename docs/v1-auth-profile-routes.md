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
