# Inference alert deduplication and cooldown

Every version 2 `inference.result`, including negative observations, goes through one Firestore
transaction before any alert is delivered
(`src/modules/alerts/infrastructure/inference-alerts.repository.ts`).

## Weapon confirmation

Require the same weapon label (`gun` or `knife`) in at least two of the last three
distinct observations from that camera, within ten seconds of the current observation.
The current observation must contain that label. Two initial positive frames can
confirm without waiting for a third. Multiple boxes of one label count once per frame.

Negative observations count in the window. Gun and knife evidence cannot confirm
each other. Duplicate events never advance the window. Observations older than 30
seconds, over five seconds in the future, or at/before the camera's last processed
observation timestamp are recorded as `ignored_stale` without modifying evidence.
This conservatively drops delayed/out-of-order results instead of allowing them to
confirm or erase newer evidence. Keep the EC2 and Azure clocks synchronized.

The window uses the model API's frame-receipt time (`captured_at`), not the time Node
received the Ably message. The producer now preserves subsecond timestamp precision.
Node compares millisecond timestamps; equal timestamps are not counted twice.

Violence does not require two observations: a fresh `violent` result is still
eligible immediately if its version 2 `violence.alert_eligible` flag is true.
This flag preserves the producer's `VIOLENCE_CONFIDENCE` decision now that weak
and negative results are also published. An unconfirmed weapon is omitted from
the alert message even when violence creates an alert.

## What the transaction decides

| Outcome | When | Writes | Delivery |
| --- | --- | --- | --- |
| `alert_created` | New event, and at least one threat type is past its cooldown | alert, cooldown, processed event | push, then Ably |
| `suppressed_cooldown` | Confirmed threats are inside cooldown | observations and processed event; cooldown times unchanged | none |
| `awaiting_confirmation` | Current weapon has insufficient matching evidence | observations and processed event | none |
| `ignored_no_threat` | No current weapon or qualifying violence | observations and processed event | none |
| `ignored_stale` | Version 2 observation is stale, future, or out of order | processed event only | none |
| `awaiting_observations` | Legacy positive-only producer cannot provide confirmation evidence | processed event only | none |
| `duplicate` | `event_id` already processed for this camera | none | none |
| `event_conflict` | `event_id` already processed for another camera | none (logged) | none |

- Threat types: confirmed `weapon`, and fresh eligible `violence`. Even results
  with neither enter the transaction so negatives and duplicate IDs are recorded.
- Cooldowns are per camera and per threat type. A type is eligible when it never
  alerted or `now >= lastAlertAt + cooldown`. A combined alert resets both
  types. Suppressed events never move the cooldown.
- `now` is Node processing time, captured once before the transaction.
  `captured_at` stays the alert's display `timeStamp`.

## Constants

In `src/modules/alerts/alerts.constants.ts`. Changing them needs a redeploy.

| Constant | Default |
| --- | --- |
| `INFERENCE_EVENT_RETENTION_DAYS` | `7` |
| `INFERENCE_ALERT_COOLDOWN_SECONDS` | `30` |
| `WEAPON_CONFIRMATION_FRAME_COUNT` | `3` |
| `WEAPON_CONFIRMATION_REQUIRED_HITS` | `2` |
| `WEAPON_CONFIRMATION_WINDOW_SECONDS` | `10` |
| `INFERENCE_OBSERVATION_MAX_AGE_SECONDS` | `30` |
| `INFERENCE_CLOCK_SKEW_SECONDS` | `5` |

## Collections

- `processed_inference_events/{sha256("inference.result:" + event_id)}`:
  `eventId`, `deviceId`, `outcome`, `alertId` (or `null`), `processedAt`,
  `expiresAt`.
- `inference_alert_cooldowns/{deviceId}`: `deviceId`, `weaponLastAlertAt`,
  `violenceLastAlertAt` (Timestamp or `null`), `lastWeaponObservedAt` (Timestamp),
  `weaponObservations` (at most three `{ observedAt: Timestamp, labels: string[] }`
  entries). Missing observation fields on older records start an empty window;
  existing cooldown times are preserved. Small; no cleanup needed.
- `alerts`: unchanged shape. Ably `alert.created` payload is unchanged.

## Firestore TTL setup (one time per project)

Without this, processed events are never deleted.

1. Google Cloud console → Firestore → **Time-to-live**.
2. **Create policy**: collection group `processed_inference_events`, timestamp
   field `expiresAt`.

Or with gcloud:

```sh
gcloud firestore fields ttls update expiresAt \
  --collection-group=processed_inference_events --enable-ttl
```

TTL deletion is eventual (typically within 24 hours of expiry). The code treats
any existing record as processed, even past `expiresAt`. Once deleted, a replay
of that old `event_id` is treated as new.

## Known limitations

- Delivery is one attempt each for push and Ably, after commit. Failures are
  logged with `eventId` and `alertId`; there is no retry. A crash between commit
  and delivery leaves a saved alert with no notification.
- Replaying an event after a failed delivery does not resend it.
- A suppressed event does not update the earlier alert.
- A continuously visible threat alerts again after each cooldown.
- A genuinely separate threat of the same type on the same camera can be
  suppressed during the cooldown.
- A persistent model false positive can still confirm; evaluate labelled camera
  footage before treating two-of-three as an accuracy improvement.
- Confirmation adds delay and can miss brief threats. Tune the ten-second window
  using real processing speed; long inference/upload delays can expire evidence.
- Only successfully processed and received observations count, not every camera
  frame. Dropped frames or failed Ably publications are not replayed by this feature.
- Negative observations increase Ably messages and Firestore reads/writes and TTL
  deletions. Each new accepted observation normally reads two documents and writes
  two; an alert adds one write. The existing inference sampler still limits input.
- Concurrency is covered by Firestore transactions but verified only with an
  in-memory fake by default. Optional emulator tests are in
  `inference-alerts.emulator.spec.ts` and require a running local emulator:

  ```powershell
  $env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
  npm.cmd test -- --runInBand inference-alerts.emulator.spec.ts
  ```

## Deploying the version 2 producer

1. Deploy this Node consumer first. It accepts legacy and v2 schemas, but legacy
   weapon-only events return `awaiting_observations` until the model API is updated.
   Legacy fresh violence keeps its previous handling. Expect a brief weapon-alert
   gap during this coordinated rollout.
2. Deploy the model API that publishes all processed frames with `schema_version: 2`
   and `violence.alert_eligible`. Older Node consumers reject those new fields, so
   do not reverse the order or leave old Node instances consuming the channel.
3. Check a negative event, one positive event, then another matching positive within
   ten seconds. Only the second matching positive should create the weapon alert.
4. Keep the current Node consumer if rolling the producer back; weapon confirmation
   will pause on legacy events. Do not roll Node back while v2 production continues.

No mobile contract change, new Firestore collection, or data migration is required.
