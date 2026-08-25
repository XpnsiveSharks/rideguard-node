# V1 Routes

These routes use URI versioning. With the default `API_VERSION=1`, every path
below is mounted under `/v1`.

Default local base URL:

```text
http://localhost:5565/v1
```

## Shared Behavior

All routes require a Firebase ID
token because `FirebaseAuthGuard` is registered globally.

```http
Authorization: Bearer <firebase-id-token>
```

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

## POST /v1/profile/personal-info

Creates a profile document for the authenticated Firebase user. The user ID,
email, and profile image URL come from the verified Firebase token.

### Request Body

| Field                    | Type   | Required | Notes                                                           |
| ------------------------ | ------ | -------- | --------------------------------------------------------------- |
| `first_name`             | string | Yes      | Must be a non-empty string after trimming.                      |
| `last_name`              | string | Yes      | Must be a non-empty string after trimming.                      |
| `phone_number`           | string | Yes      | Must be a non-empty string after trimming.                      |
| `vehicle`                | string | Yes      | Vehicle name; must be non-empty after trimming.                 |
| `plate_number`           | string | Yes      | Vehicle plate number; must be non-empty after trimming.         |
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
  "vehicle": "Honda Click 125",
  "plate_number": "ABC 1234",
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
| `409`  | A profile already exists for the authenticated user.                                        |
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
