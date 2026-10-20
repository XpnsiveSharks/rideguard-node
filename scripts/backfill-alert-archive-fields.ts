import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldPath, Timestamp } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';

dotenv.config();

// Backfills the auto-archive fields onto existing alerts (plan §9.2).
//   - createdAt : set from the existing event timeStamp when missing
//   - isArchived: set to false when missing
//   - archivedAt: set to null when missing
// Fields already present are never overwritten. The pass is bounded per page
// and resumable: a document ID cursor is printed and accepted so an interrupted
// run can continue, and re-running is safe because fully-populated docs are
// skipped. Equality queries cannot find documents with a missing field, so the
// collection is scanned by document ID rather than filtered.
//
// Usage: ts-node scripts/backfill-alert-archive-fields.ts [startAfterDocId]

const ALERTS_COLLECTION = 'alerts';
const PAGE = 300;

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
  const collection = db.collection(ALERTS_COLLECTION);
  let lastId = startAfterId;
  let scanned = 0;
  let updated = 0;

  for (;;) {
    let q = collection.orderBy(FieldPath.documentId()).limit(PAGE);
    if (lastId) q = q.startAfter(lastId);

    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let pageUpdates = 0;

    for (const doc of snap.docs) {
      const data = doc.data();
      const patch: Record<string, unknown> = {};

      if (data.createdAt === undefined) {
        // timeStamp is a Firestore Timestamp; fall back to now only if absent.
        patch.createdAt = data.timeStamp ?? Timestamp.now();
      }
      if (data.isArchived === undefined) patch.isArchived = false;
      if (data.archivedAt === undefined) patch.archivedAt = null;

      if (Object.keys(patch).length > 0) {
        batch.update(doc.ref, patch);
        pageUpdates++;
      }
    }

    if (pageUpdates > 0) await batch.commit();

    scanned += snap.docs.length;
    updated += pageUpdates;
    lastId = snap.docs[snap.docs.length - 1].id;
    console.log(`Scanned ${scanned} (updated ${updated}); cursor=${lastId}`);

    if (snap.docs.length < PAGE) break;
  }

  console.log(`Done. Scanned ${scanned} alerts, updated ${updated}.`);
}

const db = getFirestore(app());
backfill(db, process.argv[2]).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
