# Manual SOS routes

All routes use `/v1`, Firebase Bearer authentication, and the standard
`{ success, message, data, timestamp }` success envelope. User identity comes
from authentication. SOS activation and SMS processing are disabled by default
with `SOS_ENABLED=false`; this work does not enable them.

| Method and path | Result |
| --- | --- |
| `POST /sos` | 201 for a new SOS; 200 for a replay or an existing active SOS |
| `GET /sos/active` | Active SOS, or `data: null` |
| `GET /sos/by-request/:requestId` | SOS associated with this user's UUID request ID, including ended records; 404 when absent |
| `GET /sos/:sosId` | Owned SOS, including ended records; 404 for absent or foreign IDs |
| `POST /sos/:sosId/stop` | 200 with an ended SOS; repeatable without duplicate end updates |
| `GET /alerts/:alertId/sos` | Latest linked SOS owned by this user, including ended records, or `data: null`; validates alert ownership first |

## Activation and alert ownership

Send `{ "requestId": "<UUID>", "alertId": "<optional owned alert ID>", "location": null }`.
Omit `alertId` or send null for an unlinked SOS. A supplied ID must be a nonempty
string without `/`, at most 1500 characters. Do not supply recipients, message
text, or a user ID. The existing optional location DTO is unchanged.

Alert ownership uses the same assigned-device check as alert status updates.
Absent and foreign alerts return the same 404. Archived or false-alarm alerts
still use that ownership check. Reading an alert for SOS does not mark it seen
or change its false-alarm status.

Every public SOS includes nullable `alertId`. Older stored records without the
field return null. Responses mask recipient phone numbers and omit user IDs,
requester names, and provider IDs. Provider acceptance does not mean delivery.

Request mappings are scoped to the authenticated user. Replaying the same
normalized input returns the original SOS, even after stop, without validating
contacts again or sending another initial SMS. A changed alert ID returns
409 with `SOS_REQUEST_CONFLICT`. Unlinked mappings created before alert
linking retain their existing fingerprint and remain replayable.

If another SOS is active, a new request maps to it without changing its original
alert, location, recipients, or request ID. A newly supplied alert is validated
before that request is accepted. Lookup by the new request resolves the same SOS;
lookup by the new alert returns no association unless an SOS was actually created
with that alert.

Alert lookup checks current alert ownership before querying SOS records and
filters SOS ownership separately. It chooses the latest `createdAt`, with the
larger SOS ID breaking equal-time ties. It uses a single-field `alertId` query
and selects the latest record in memory. No new index configuration is needed;
the query currently reads all SOS records associated with that alert.

Errors include 400 for invalid input, 401 for missing/invalid authentication,
404 for absent/foreign resources, 409 for conflicting request reuse, 422 with
`SOS_NO_CONTACTS` for no usable contacts, and 503 with `SOS_DISABLED` when
new activation is disabled. Reads and replay remain available when disabled.

## Local Postman collection

`docs/postman/RideGuard_SOS.postman_collection.json` follows the existing
Postman v2.1 JSON layout. It includes activation, replay, active/request/alert/ID
lookups, stop and repeat stop, ended lookups, authentication failure, foreign
resources, malformed input, request conflicts, and no-contact cases. Saved
examples contain masked test data and no location snapshot or SMS content.

The collection blocks all requests unless `sosTestMode=stubbed`, and restricts
`baseUrl` to a loopback HTTP `/v1` URL. That flag is an operator assertion, not
server-side proof that a sender is fake. Use the isolated test below; do not
point this collection at a backend configured with a real SMS provider.

Run the saved collection against the real controllers and service with fake
authentication, persistence, alerts, and SMS dependencies from PowerShell:

```powershell
$env:RUN_SOS_POSTMAN = 'true'
try {
  npx.cmd jest --runInBand src/modules/sos/sos.service.spec.ts
} finally {
  Remove-Item Env:RUN_SOS_POSTMAN
}
```

The opt-in test starts a temporary loopback listener and invokes the installed
Postman CLI with `--no-report-events`. It supplies only fake local credentials
and fixture IDs, then shuts down the listener. It does not load `.env`, connect
to Firestore/Firebase, or instantiate a real SMS adapter. Collection scripts
do not retry submissions. No Postman workspace is created or published.

To run outside that test harness, use an equivalent isolated backend and supply
`baseUrl`, `sosTestMode`, `firebaseIdToken`, `foreignToken`, `noContactsToken`,
`alertId`, `unlinkedAlertId`, and `foreignAlertId` through local variables.
The owned unlinked alert must have no associated SOS. Tokens stay out of Git.
