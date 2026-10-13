# V1 Alert and Notification Routes

All routes use URI versioning. With the default `API_VERSION=1`, paths start
with `/v1`. All routes require a Firebase ID token.

## Alerts

### GET /v1/alerts

Returns alerts for the signed-in user.

Query parameters:

- `limit` - page size
- `cursor` - next-page cursor

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
