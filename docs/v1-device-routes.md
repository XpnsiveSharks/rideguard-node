# V1 Device Routes

Routes exposed by [devices.controller.ts](../src/modules/devices/devices.controller.ts).

These routes use URI versioning. With the default `API_VERSION=1`, every path
below is mounted under `/v1`.

Default local base URL:

```text
http://localhost:5565/v1
```

## Route Summary

| Method  | Path                                | Consumer     | Auth                | Purpose                                    |
| ------- | ----------------------------------- | ------------ | ------------------- | ------------------------------------------ |
| `POST`  | `/v1/devices` | Admin / manufacturing staff | Firebase ID token + `admin`/`manufacturing` role | Register a new hardware unit in inventory. |
| `PATCH` | `/v1/devices/claim-device/:device_id` | Mobile app | Firebase ID token   | Bind an existing device to the caller.     |
| `PATCH` | `/v1/devices/activate-device/:device_id` | Hardware device | **Public** | Mark the device as provisioned on boot.    |
| `PATCH` | `/v1/devices/:device_id/rotate-secret` | Admin / manufacturing staff | Firebase ID token + `admin`/`manufacturing` role | Replace a device's secret without changing its ID. |
| `POST` | `/v1/devices/:device_id/ably-token` | ESP32 button | Device secret bearer token | Issue a short-lived Ably publisher token. |

## Consumers

- **Admin app** — internal operator tool. Calls `POST /v1/devices` when a new
  physical unit is added to inventory.
- **Mobile app** — the rider's phone app. Calls `claim-device` after the rider
  scans or types the device ID printed on the unit.
- **Hardware device** — firmware on a camera or button. Calls `activate-device`
  without a Firebase token. Buttons use their device secret to request Ably tokens.

## Shared Behavior

`FirebaseAuthGuard` is registered globally, so every route requires a Firebase
ID token unless the handler is marked `@Public()`.

```http
Authorization: Bearer <firebase-id-token>
```

Successful responses are wrapped by `ResponseInterceptor`. Registration and
secret rotation return the device ID and one-time secret in `data`. The hardware
token route returns the Ably token details and channel in `data`. Handlers that
return no payload use an empty object.

Device IDs use the format `CAM-123-ABC`: a three-letter prefix derived from the
device type, three digits, and three letters, separated by `-`.

| Device type      | ID prefix | Example       |
| ---------------- | --------- | ------------- |
| `camera` | `CAM` | `CAM-482-QLZ` |
| `button` | `BUT` | `BUT-123-ABC` |

## POST /v1/devices

**Consumer: Admin / manufacturing staff (`admin` or `manufacturing` role).**

Generates a device ID from the device type, then stores the device with status
`standby`.

### Request Body

| Field         | Type   | Required | Notes                                    |
| ------------- | ------ | -------- | ---------------------------------------- |
| `device_type` | string | Yes | Must be `camera` or `button`. |

Unknown properties are rejected by the global validation pipe.

Example:

```json
{
  "device_type": "button"
}
```

### Success Response

Status `201 Created`. The response includes `Cache-Control: no-store` and
returns the generated device ID and its secret in `data`.

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {
    "deviceId": "BUT-123-ABC",
    "deviceSecret": "<generated-secret>"
  },
  "timestamp": "2026-09-05T00:00:00.000Z"
}
```

> **Note:** `deviceSecret` is returned only once, right after the device is
> created. The server stores only a SHA-256 hash of it, so the raw secret cannot
> be retrieved later through any lookup or update route. The manufacturing tool
> must capture both values from this response and flash them onto the unit. If a
> unique ID cannot be generated after several attempts, the request fails with
> `409` instead of returning a secret.

### Errors

| Status | Reason                                                                    |
| ------ | ------------------------------------------------------------------------- |
| `400`  | `device_type` missing, not one of the supported values, or unknown fields sent. |
| `401`  | Missing or invalid Firebase bearer token.                                 |
| `409`  | Could not generate a unique device ID after several attempts.             |
| `429`  | Request exceeded the global throttle limit.                               |

Validation error example:

```json
{
  "success": false,
  "message": "Validation failed",
  "statusCode": 400,
  "timestamp": "2026-09-05T00:00:00.000Z",
  "fields": {
    "device_type": "Invalid device type"
  }
}
```

## PATCH /v1/devices/claim-device/:device_id

**Consumer: Mobile app.**

Assigns the device to the authenticated Firebase user. The user ID comes from
the verified token, not from the request body.

### Request

| Parameter   | In   | Type   | Required | Notes                                     |
| ----------- | ---- | ------ | -------- | ----------------------------------------- |
| `device_id` | Path | string | Yes      | Existing device ID, e.g. `CAM-482-QLZ`.   |

No request body.

```http
PATCH /v1/devices/claim-device/CAM-482-QLZ
Authorization: Bearer <firebase-id-token>
```

### Success Response

Status `200 OK`. The handler returns no payload.

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {},
  "timestamp": "2026-09-05T00:00:00.000Z"
}
```

### Errors

| Status | Reason                                                            |
| ------ | ----------------------------------------------------------------- |
| `400`  | `device_id` is blank or whitespace only.                          |
| `401`  | Missing or invalid Firebase bearer token.                         |
| `404`  | No device exists with the given ID.                               |
| `422`  | The verified token did not provide a user ID.                     |
| `429`  | Request exceeded the global throttle limit.                       |

> **Note:** the route does not check whether the device is already claimed by
> another user — a second claim overwrites `assignedUserId`.

## PATCH /v1/devices/activate-device/:device_id

**Consumer: Hardware device (firmware).**

Marked `@Public()`, so the guard is skipped and no bearer token is required.
Sets the device status to `Provisioned`.

### Request

| Parameter   | In   | Type   | Required | Notes                                     |
| ----------- | ---- | ------ | -------- | ----------------------------------------- |
| `device_id` | Path | string | Yes      | Existing device ID, e.g. `CAM-482-QLZ`.   |

No request body, no `Authorization` header.

```http
PATCH /v1/devices/activate-device/CAM-482-QLZ
```

### Success Response

Status `200 OK`. The handler returns no payload.

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {},
  "timestamp": "2026-09-05T00:00:00.000Z"
}
```

### Errors

| Status | Reason                                      |
| ------ | ------------------------------------------- |
| `400`  | `device_id` is blank or whitespace only.    |
| `404`  | No device exists with the given ID.         |
| `429`  | Request exceeded the global throttle limit. |
| `500`  | Unexpected server error during activation.  |

> **Note:** the controller comment lists `422` for this route, but
> `activateDevice` never throws `UnprocessableEntityException` — that status
> only comes from `claim-device`.

## PATCH /v1/devices/:device_id/rotate-secret

**Consumer: Admin / manufacturing staff.**

Generates a new secret for an existing device, stores only its SHA-256 hash, and
returns the new raw secret once. The device's ID, owner, status, and history are
unchanged. A valid Firebase token is not enough: the token must carry a `role`
custom claim of `admin` or `manufacturing`, or the request is rejected with
`403`.

### Request

| Parameter   | In   | Type   | Required | Notes                                     |
| ----------- | ---- | ------ | -------- | ----------------------------------------- |
| `device_id` | Path | string | Yes      | Existing device ID, e.g. `BUT-123-ABC`.   |

No request body. The secret is always generated on the backend.

```http
PATCH /v1/devices/BUT-123-ABC/rotate-secret
Authorization: Bearer <firebase-id-token>
```

### Success Response

Status `201 Created`. The response includes `Cache-Control: no-store` and
returns the device ID and its new secret in `data`.

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {
    "deviceId": "BUT-123-ABC",
    "deviceSecret": "<new-generated-secret>"
  },
  "timestamp": "2026-09-05T00:00:00.000Z"
}
```

> **Note:** `deviceSecret` is returned only once, right after the update
> succeeds. Staff must write this new secret onto the ESP32; the old secret stops
> working for new token requests immediately. The server stores only the hash, so the
> raw secret cannot be retrieved later. A device that never had a secret can
> receive one through this route. Existing Ably tokens stay valid until they
> expire unless revoked separately.

### Errors

| Status | Reason                                                            |
| ------ | ---------------------------------------------------------------- |
| `400`  | `device_id` is blank or whitespace only.                         |
| `401`  | Missing or invalid Firebase bearer token.                        |
| `403`  | Token lacks the `admin` or `manufacturing` role claim.           |
| `404`  | No device exists with the given ID.                              |
| `429`  | Request exceeded the global throttle limit.                      |

## POST /v1/devices/:device_id/ably-token

**Consumer: ESP32 button firmware.**

Requests a usable Ably token from the app containing `DEVICE_ABLY_ISSUER_API_KEY`.
The key stays on the backend. The device authenticates using its own secret,
issued at registration or secret rotation, not a Firebase token.

### Request

```http
POST /v1/devices/BUT-123-ABC/ably-token
Authorization: Bearer <device-secret>
```

No request body is needed. Channel, client ID, token lifetime, and capability
are selected by the backend; body and query parameters cannot override them.
Use HTTPS outside local development.

PowerShell example (replace the placeholders):

```powershell
curl.exe -X POST "https://<api-host>/v1/devices/BUT-123-ABC/ably-token" `
  -H "Authorization: Bearer <device-secret>"
```

The device must be a registered `button` with a valid `deviceSecretHash`.
The service hashes the supplied secret without changing it and compares the
hashes with `timingSafeEqual`. Legacy devices without a hash must receive a new
secret through the staff-only rotation route before using this endpoint.
Claiming or activating the device is not required to request this token.

Although the handler has `@Public()` to skip Firebase authentication, it still
requires valid device credentials. The global request throttle also applies.

### Success response

Status `200 OK`, with `Cache-Control: no-store`:

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {
    "token": "<ably-token>",
    "clientId": "BUT-123-ABC",
    "issued": 1800000000000,
    "expires": 1800003600000,
    "capability": "{\"rideguard:buttons:device:BUT-123-ABC\":[\"publish\"]}",
    "channel": "rideguard:buttons:device:BUT-123-ABC"
  },
  "timestamp": "2027-01-15T08:00:00.000Z"
}
```

Firmware should use `data.token` to authenticate to Ably, `data.channel` as the
publish channel, and `data.clientId` if it explicitly sends a client ID.
`issued` and `expires` are Unix timestamps in milliseconds. `capability` is a
JSON-encoded string. The response is a token, not a signed `TokenRequest`.

The token lasts one hour and grants only `publish` on the device's channel.
It does not grant subscribe, history, presence, or access to other devices.
Renew by calling this endpoint again before expiry (for example, one minute
early). Retry transient failures with backoff; do not request a token for
every button press. Renewals recheck the current device secret hash.

After secret rotation, the old secret cannot obtain new tokens. Tokens already
issued remain valid until expiry unless separately revoked.

The dedicated issuer key must permit `publish` on `rideguard:buttons:device:*`.
Subscribers must use the same Ably app as that key. This route only issues
credentials; receiving button events and creating alerts require a consumer.

### Errors

| Status | Reason |
| ------ | ------ |
| `401` | Missing/malformed credentials, invalid/unknown device ID, incorrect secret, or missing/malformed stored hash. All return `Invalid device credentials`. |
| `403` | Valid credentials belong to a device that is not a button. |
| `429` | Request exceeded the global throttle limit. |
| `500` | Database lookup or another unexpected backend operation failed. |
| `503` | Ably could not issue the token, including unavailable service or invalid issuer permissions. SDK error details are not returned. |

## Known Gaps

These are behaviors worth confirming before the routes are treated as final:

1. `activate-device` is fully public and takes only a device ID, so anyone who
   knows or guesses an ID can flip it to `Provisioned`. IDs are 3 digits plus
   3 letters (~17.5M combinations per prefix), guarded only by the throttler.
