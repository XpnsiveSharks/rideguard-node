# Inference alert deduplication and cooldown

Every `inference.result` with a qualifying threat goes through one Firestore
transaction before any alert is delivered
(`src/modules/alerts/infrastructure/inference-alerts.repository.ts`).

## What the transaction decides

| Outcome | When | Writes | Delivery |
| --- | --- | --- | --- |
| `alert_created` | New event, and at least one threat type is past its cooldown | alert, cooldown, processed event | push, then Ably |
| `suppressed_cooldown` | New event, every threat type is inside its cooldown | processed event only | none |
| `duplicate` | `event_id` already processed for this camera | none | none |
| `event_conflict` | `event_id` already processed for another camera | none (logged) | none |

- Threat types: `weapon` (any detected object) and `violence` (`label ===
  'violent'` and `inference_ran === true`). A result with neither never reaches
  the transaction.
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

## Collections

- `processed_inference_events/{sha256("inference.result:" + event_id)}`:
  `eventId`, `deviceId`, `outcome`, `alertId` (or `null`), `processedAt`,
  `expiresAt`.
- `inference_alert_cooldowns/{deviceId}`: `deviceId`, `weaponLastAlertAt`,
  `violenceLastAlertAt` (Timestamp or `null`). Small; no cleanup needed.
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
- Model false positives still alert; the cooldown only limits repeats.
- Concurrency is covered by Firestore transactions but verified only with an
  in-memory fake, not the emulator.
