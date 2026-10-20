# Alert auto archive

Moves alerts out of the Active list into Archived once they reach an
account-chosen age. Nothing is deleted: records, images, and videos are kept.
Full design in `../../docs/unimplemented-features/auto-archive-implementation-plan.md`.

## Data

`profiles/{uid}.autoArchiveHours`: `24 | 48 | 72 | null`. Missing means Never.

Every alert carries:

- `createdAt` — backend alert-creation time (inference `processedAt`), captured
  once outside transaction retries. Distinct from the event `timeStamp`.
- `isArchived` — boolean, default `false`.
- `archivedAt` — Firestore timestamp set when the processor archives the alert,
  else `null`.

`archiveAt` is **not** stored. It is computed per response from
`createdAt + autoArchiveHours` (null when Never, or the stored `archivedAt` when
already archived).

## Background processor

`AutoArchiveProcessorService` runs a bounded pass on startup and every ~60s in
the Node process (no queue). Each pass:

1. Lists profiles with `autoArchiveHours in [24, 48, 72]` (fresh read, so a
   changed preference takes effect next pass — the retroactive rule).
2. Resolves each account's assigned device IDs via the existing ownership model.
3. Selects up to `MAX_ALERTS_PER_ACCOUNT_PER_PASS` (500) candidate alerts with a
   cheap query (`isFalseAlarm == false`, `isArchived == false`,
   `createdAt <= now - hours`), bounding the work per pass. Because an archived
   alert drops out of that query, the next pass resumes with whatever remains.
4. Archives each candidate in its own transaction (`archiveOneIfDue`). Inside
   the transaction it re-reads and rechecks, before writing:
   - the alert — skip if gone, already archived, or now a false alarm;
   - the account preference — skip if now Never / not 24·48·72 (honors a
     concurrent change to Never);
   - the device assignment — skip if the device is no longer owned by the
     account (ownership changed);
   - the due time against the *re-read* preference — skip if not yet due (a
     preference extended mid-pass leaves the alert active).

   Only then does it set `isArchived: true`, `archivedAt: serverTimestamp()`.
   An alert already archived by a concurrent/duplicate worker is left untouched,
   so its original `archivedAt` is preserved.

Overlapping runs within a process are prevented with an in-flight guard, and the
per-candidate transaction makes duplicate workers across processes harmless. The
timer is registered/cleaned up with the module lifecycle. Timing is "near the
deadline, within ~1 minute plus processing while the backend is running," not
exact-second.

### Enabling

Gated by `AUTO_ARCHIVE_ENABLED` (Joi boolean, default `false`). Keep it off
until the backfill and indexes below are verified, then set it to `true`.

## Migration

1. Deploy the additive fields/endpoints with `AUTO_ARCHIVE_ENABLED=false`. All
   alert-creation paths already write the new fields.
2. Backfill existing alerts (idempotent, resumable, additive-only):

   ```bash
   ts-node scripts/backfill-alert-archive-fields.ts [startAfterDocId]
   ```

   Missing `createdAt` uses `timeStamp`; missing `isArchived` becomes `false`;
   missing `archivedAt` becomes `null`. Populated fields are never overwritten.
   Equality queries do not match documents with a missing field, so the backfill
   is required before the processor can see legacy alerts.
3. Deploy the composite indexes and wait until they finish building:

   ```bash
   firebase deploy --only firestore:indexes
   ```

   Indexes (`firestore.indexes.json`): the Active/Archived list index adds
   `isArchived`, and the processor index covers `isArchived == false` with a
   `createdAt` range. Verify in the emulator and staging first.
4. Set `AUTO_ARCHIVE_ENABLED=true`. Accounts without a preference stay on Never.

Do not attach a Firestore TTL to alerts. The unrelated
`processed_inference_events.expiresAt` TTL is deduplication cleanup only.
