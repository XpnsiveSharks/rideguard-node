import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';

dotenv.config();

// Adds fields required by indexed station queries and the incident response contract.
// Existing values are never overwritten. The scan is bounded, resumable, and idempotent.
// Usage: ts-node scripts/backfill-authority-incident-fields.ts [startAfterDocId]

const INCIDENTS_COLLECTION = 'authority_incidents';
const PAGE_SIZE = 300;

function app() {
  return (
    getApps()[0] ??
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    })
  );
}

async function backfill(db: FirebaseFirestore.Firestore, startAfterId?: string) {
  const collection = db.collection(INCIDENTS_COLLECTION);
  let lastId = startAfterId;
  let scanned = 0;
  let updated = 0;

  for (;;) {
    let query = collection.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (lastId) query = query.startAfter(lastId);

    const snapshot = await query.get();
    if (snapshot.empty) break;

    const batch = db.batch();
    let pageUpdates = 0;
    for (const document of snapshot.docs) {
      const data = document.data();
      const patch: Record<string, unknown> = {};
      if (data.notifiedStationIds === undefined) {
        const recipients: unknown[] = Array.isArray(data.notifiedRecipients)
          ? data.notifiedRecipients
          : [];
        patch.notifiedStationIds = recipients
          .map((recipient) =>
            typeof recipient === 'object' && recipient !== null && 'stationId' in recipient
              ? recipient.stationId
              : undefined,
          )
          .filter((stationId): stationId is string => typeof stationId === 'string');
      }
      if (data.readReceipts === undefined) patch.readReceipts = {};

      if (Object.keys(patch).length > 0) {
        batch.update(document.ref, patch);
        pageUpdates++;
      }
    }

    if (pageUpdates > 0) await batch.commit();
    scanned += snapshot.docs.length;
    updated += pageUpdates;
    lastId = snapshot.docs.at(-1)?.id;
    console.log(`Scanned ${scanned} (updated ${updated}); cursor=${lastId}`);
    if (snapshot.docs.length < PAGE_SIZE) break;
  }

  console.log(`Done. Scanned ${scanned} incidents, updated ${updated}.`);
}

backfill(getFirestore(app()), process.argv[2]).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
