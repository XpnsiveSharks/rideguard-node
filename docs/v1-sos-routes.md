# Manual SOS routes

All routes use `/v1`, Firebase Bearer authentication, and the standard
`{ success, message, data, timestamp }` success envelope. User identity comes
from authentication. SOS activation and dispatch recovery are disabled by default
with `SOS_ENABLED=false`. Saved status reads and delivery lookups remain available.

| Method and path | Result |
| --- | --- |
| `POST /sos` | 201 for a new SOS; 200 for a replay or an existing active SOS |
| `GET /sos/active` | Active SOS, or `data: null` |
| `GET /sos/by-request/:requestId` | SOS associated with this user's UUID request ID, including ended records; 404 when absent |
| `GET /sos/:sosId` | Owned SOS, including ended records; 404 for absent or foreign IDs |
| `POST /sos/:sosId/stop` | 200 with an ended SOS; repeatable without duplicate end updates |
| `POST /sos/:sosId/refresh-status` | Empty `{}` body; 202 for scheduled/pending status-only work, 200 for cooldown/no work; never sends SMS |
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

## Message delivery contract

Both `initial` and non-null `ended` summaries retain the original submission enum
and include `delivery: null` or a separate delivery summary. Accepted submissions
stay accepted after delivery failure. Historical `failed` + `delivery_failed`
remains a failure. `ended` stays null until an end update exists. There is no history
rewrite or automatic tracking of legacy records. Original provider/device evidence
is required; legacy IDs alone never cause lookups against today's default device.

`delivery` contains `status` (pending/sent/delivered/failed/unknown), `observedAt`,
immutable `acceptedAt` and `expiresAt`, `tracking` (active/complete/timed_out/unavailable),
`lastAttemptAt`, `lastCheckedAt`, `lastCheckError`, and `failureCode`.
All times are Node ISO UTC. `observedAt` is Node's first observation of that state,
not the carrier event time. Attempt time advances before HTTP; successful check time
advances only for recognized results. Errors never erase confirmed progress.
Null delivery means no honest tracking evidence, not success or failure.

Pending means confirmation is awaited; sent means carrier acceptance; only delivered
means a receipt was confirmed. Completed batches do not prove delivery. Per-message
results take precedence. TextBee's rare `delivery_failed` is uncertain; it does not
mean the same thing as the historical application error code. Terminal delivery
results cannot be overwritten by a later lower-progress response. Known sent
survives unknown results, timeouts and malformed responses.

New acceptances track independently for five minutes, including end updates after
SOS ends. Checks are due immediately, then at 5s for the first 60s, then 15s.
Intervals start at the previous attempt start, with no missed-tick replay.
Consecutive transport failures back off 10/20/40/60s; recognized results reset this.
429 respects Retry-After (seconds or date), defaulting to 60s, with a persisted
TextBee account cooldown shared by workers. Authentication/configuration/missing
resource errors stop automatic tracking as unavailable. Timeouts are not failures.
No new automatic HTTP request starts at/after expiry; a valid in-flight result can
still be saved. Delivery failure excludes newly created end-update recipients.

Every public SOS includes `statusRefresh`, defaulting to idle with null timestamps.
Manual jobs coalesce in Firestore, have a 30s per-SOS cooldown and a 60s lifetime.
Each eligible nonterminal tracked message gets at most one new lookup. A successful
automatic check less than 5s old, or an in-flight check, can satisfy it. Complete
means every lookup returned a recognized result; partial/unavailable reflect lookup
coverage, not SMS delivery. Late manual checks never extend the automatic deadline.
No-work/cooldown responses do not invent a check time. Unknown provider results
remain uncertain even when the lookup job completes. Body fields are rejected
with 400; authentication is 401; absent/foreign IDs are the same 404.

Provider IDs, saved sending device, due times, failures, revision and lease stay
backend-only. Leases last at least 30s and exceed the configured HTTP timeout by
10s; revisions fence reclaimed work. Firestore transactions contain no provider
calls. A singleton worker allows at most two concurrent status calls per process.
It runs independently of the activation flag and mobile visibility.

Scheduling queries use the single ascending collection index `sos.deliveryDueAt`,
explicitly included in `firestore.indexes.json`; no new composite index is needed.
Records without new delivery evidence are not added to that queue. The existing
submission recovery scan is unchanged. Prepare the index before backend rollout,
then release mobile. Do not run a migration that fabricates old acceptance times.
The shared `sos_delivery_control/textbee` record assumes this deployment uses one
TextBee account. Keep that collection backend-only, like the existing SOS stores.

Old mobile clients continue parsing submission fields but show neither confirmed
delivery nor all later delivery failures. New mobile supports missing delivery/job
fields; a refresh route 404 falls back once to the owned GET. Only a successful GET
allows it to call enhanced refresh unavailable. No status action invokes dispatch.

Provider mapping was checked against the [delivery documentation](https://textbee.dev/docs/sending-sms/delivery-status)
and [API reference](https://textbee.dev/docs/api-reference) on 2026-10-25. Local
simulations do not establish carrier delivery or current production behavior.

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

## Delivery worker diagnostics

When an accepted message stays Submitted, compare its saved delivery evidence
with the provider's per-message result. Successful GET or refresh-status requests
do not establish that the worker actually checked delivery.

The worker logs `SOS delivery worker started` at application initialization and
`SOS delivery query ready` after its first successful queue query. A scheduling
operation taking over a minute produces a warning with its `query` or `finalize`
stage, at most once a minute, without starting overlapping work. Scheduling and
check failures log a sanitized error code, never raw SDK errors, SMS content,
phone numbers, or provider credentials. These diagnostics do not resend messages
or change the five-minute tracking window.
