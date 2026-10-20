# V1 Alert and Notification Routes

All routes use URI versioning. With the default `API_VERSION=1`, paths start
with `/v1`. All routes require a Firebase ID token.

## Alerts

### GET /v1/alerts

Returns alerts for the signed-in user. False alarms are always excluded.

Query parameters:

- `limit` - page size
- `cursor` - next-page cursor (opaque alert ID; keep a separate cursor per tab)
- `status` - optional, `active` or `archived`. Filters by stored archive state
  before paginating. Omitted keeps the existing all-non-false-alarm behavior for
  older clients. An unsupported value returns `400`.

Each alert carries the auto-archive fields (see the shape below). `archiveAt` is
derived presentation data: `createdAt + autoArchiveHours`, or `null` when the
preference is Never. For an already-archived alert the stored `archivedAt` is
returned instead of a future time. Legacy records normalize to
`isArchived: false`, `archivedAt: null`, `createdAt: timeStamp`.

```json
{
  "alertFields": {
    "alertId": "alert-123",
    "deviceId": "CAM-472-OAN",
    "message": "Possible violence detected",
    "imageUrl": "https://media.example.com/image.jpg",
    "videoUrl": "https://media.example.com/clip.mp4",
    "timeStamp": "2026-10-16T06:59:58Z",
    "createdAt": "2026-10-16T07:00:00Z",
    "isSeen": false,
    "isFalseAlarm": false,
    "isArchived": false,
    "archivedAt": null,
    "archiveAt": "2026-10-18T07:00:00Z"
  }
}
```

### PATCH /v1/alerts/:alertId/seen

Updates the `isSeen` value.

```json
{
  "isSeen": true
}
```

### PATCH /v1/alerts/:alertId/false-alarm

Updates the `isFalseAlarm` value.

```json
{
  "isFalseAlarm": true
}
```

## Notifications

### POST /v1/notifications/register

Registers a push notification device.

```json
{
  "installationId": "installation-id",
  "registrationId": "push-token",
  "platform": "ios",
  "deviceName": "Jane's phone"
}
```

Returns `204 No Content`.

### DELETE /v1/notifications/registrations/:installationId

Removes a push notification registration for the signed-in user.

Returns `204 No Content`.
