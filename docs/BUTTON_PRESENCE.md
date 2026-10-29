# Quick Button presence

`GET /v1/devices/buttons` requires the rider's Firebase bearer token. It returns
only that authenticated account's assigned buttons, sorted by device ID, inside
the normal success envelope:

```json
{"success":true,"data":[{"device_id":"BUT-111-AAA","online":true,"last_seen_at":"2026-10-29T12:00:00.000Z"}]}
```

No button assignments returns an empty array. No secret, hash, owner identifier
or manufacturing credential is included. Unknown/unverified Firebase sessions
are rejected; scheduled account deletion retains the existing guard behavior.

`POST /v1/devices/:device_id/heartbeat` uses `Authorization: Bearer <device secret>`,
the same per-device secret as the existing hardware Ably-token route. It bypasses
Firebase authentication only to validate this hardware credential. The route
rejects missing/invalid secrets with 401 and camera credentials with 403.
No body is required. Client timestamps and owner fields have no effect.

The backend writes `lastSeenAt` and `updatedAt` using Firestore server timestamps.
It rechecks the verified credential hash inside the transaction, so rotating a
secret during a request prevents that old credential from refreshing presence.
Heartbeats do not activate, claim, unpair or generate SOS/capture actions.

The normal 200 success envelope contains:

```json
{"device_id":"BUT-111-AAA","heartbeat_interval_ms":30000,"online_timeout_ms":90000}
```

A button is online while its last accepted heartbeat is no more than 90 seconds
old. Missing, expired or future timestamps report offline. No scheduled cleanup
is required. Mobile polls while focused and refreshes on foregrounding; a lost
connection therefore becomes visible within the heartbeat window plus one poll.
An unavailable API is shown as unavailable, rather than offline.

## Rollout

1. Deploy this backend after its checks and CI pass.
2. Flash the updated button firmware with that unit's existing ID and secret.
3. Install the updated mobile build.

Existing firmware can still publish button presses but does not send heartbeats.
It will show offline until updated. The mobile app handles a 404 from an older
backend as unsupported status and keeps the locally claimed button ID.
No new Firestore index is needed: inventory reuses the assigned-user query.

The firmware sends short, single heartbeat attempts from the existing network
worker while its event queue is idle. Queued button/SOS events take priority,
and the GPIO/SOS input loop remains independent of network calls. Heartbeat
network failure retries after 10 seconds; 401/403/404 back off for five minutes.
Device secrets remain in the board's private configuration, never in the mobile app.

Use `docs/postman/hardware-presence.postman_collection.json` with private local
values for `firebaseToken`, `buttonId`, and `deviceSecret`. Do not run heartbeat
requests against real hardware records as an unattended test: doing so changes
their last-seen status. Test with the in-memory HTTP tests or a disposable fixture.

Local checks do not verify a deployment or a flashed physical board. Test power
on, power off past the timeout, Wi-Fi loss/reconnect, and a second signed-in phone
before claiming physical-device verification.
