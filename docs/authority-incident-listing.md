# Authority incident listing deployment

`GET /authority/incidents` uses an indexed, cursor-paginated query. The response is:

```json
{
  "data": [],
  "nextCursor": null
}
```

`readAt` and `readByUid` are projected from the requesting station's receipt. Reading an
incident at one notified station does not change another station's unread state.

Query parameters:

- `stationId`: required for station administrators; operators always use their token claim.
- `limit`: optional integer from 1 to 100; defaults to 50.
- `cursor`: optional incident ID returned as `nextCursor`.

## Deployment order

1. Deploy `firestore.indexes.json` and wait for the `authority_incidents` index to finish building.
2. Run `npx ts-node scripts/backfill-authority-incident-fields.ts` against the target project.
3. Deploy the backend.
4. Run the backfill again to cover incidents created between steps 2 and 3.

The backfill is resumable and idempotent. Pass its last printed document ID after an interruption:

```sh
npx ts-node scripts/backfill-authority-incident-fields.ts <lastDocumentId>
```

Do not enable polling clients until the index is ready and the final backfill completes.
