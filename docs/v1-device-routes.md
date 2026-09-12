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
| `POST`  | `/v1/devices/register-device`       | Admin app    | Firebase ID token   | Register a new hardware unit in inventory. |
| `PATCH` | `/v1/devices/claim-device/:device_id` | Mobile app | Firebase ID token   | Bind an existing device to the caller.     |
| `PATCH` | `/v1/devices/activate-device/:device_id` | Hardware device | **Public** | Mark the device as provisioned on boot.    |

## Consumers

- **Admin app** — internal operator tool. Calls `register-device` when a new
  physical unit is added to inventory.
- **Mobile app** — the rider's phone app. Calls `claim-device` after the rider
  scans or types the device ID printed on the unit.
- **Hardware device** — the firmware on the camera / metal detector itself.
  Calls `activate-device` from the unit, so it carries no Firebase token.

## Shared Behavior

`FirebaseAuthGuard` is registered globally, so every route requires a Firebase
ID token unless the handler is marked `@Public()`.

```http
Authorization: Bearer <firebase-id-token>
```

Successful responses are wrapped by `ResponseInterceptor`. None of the device
handlers return a payload, so `data` is always an empty object.

Device IDs use the format `CAM-123-ABC`: a three-letter prefix derived from the
device type, three digits, and three letters, separated by `-`.

| Device type      | ID prefix | Example       |
| ---------------- | --------- | ------------- |
| `Camera`         | `CAM`     | `CAM-482-QLZ` |
| `Metal-Detector` | `MET`     | `MET-071-XKD` |

## POST /v1/devices/register-device

**Consumer: Admin app.**

Generates a device ID from the device type, then stores the device with status
`Standby`.

### Request Body

| Field         | Type   | Required | Notes                                    |
| ------------- | ------ | -------- | ---------------------------------------- |
| `device_type` | string | Yes      | Must be `Camera` or `Metal-Detector`.    |

Unknown properties are rejected by the global validation pipe.

Example:

```json
{
  "device_type": "Camera"
}
```

### Success Response

Status `201 Created`. The handler returns no payload.

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {},
  "timestamp": "2026-09-05T00:00:00.000Z"
}
```

> **Note:** the generated device ID is not returned. The admin app has to read
> it from Firestore (`devices` collection) to learn which ID was created. Also,
> if the generated ID collides with an existing document, the service skips the
> write and still responds `201` — the caller cannot tell the difference.

### Errors

| Status | Reason                                                                    |
| ------ | ------------------------------------------------------------------------- |
| `400`  | `device_type` missing, not one of the supported values, or unknown fields sent. |
| `401`  | Missing or invalid Firebase bearer token.                                 |
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

## Known Gaps

These are behaviors worth confirming before the routes are treated as final:

1. `register-device` is labelled an admin route but has no role check. Any
   authenticated Firebase user can register a device.
2. `activate-device` is fully public and takes only a device ID, so anyone who
   knows or guesses an ID can flip it to `Provisioned`. IDs are 3 digits plus
   3 letters (~17.5M combinations per prefix), guarded only by the throttler.
3. `register-device` does not surface the generated device ID, and swallows ID
   collisions instead of retrying.
