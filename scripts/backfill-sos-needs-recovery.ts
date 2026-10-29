import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';
import { needsRecovery } from '../src/modules/sos/sos-delivery';
import { SOS_COLLECTION } from '../src/modules/sos/sos.constants';
import type { SosRecord } from '../src/modules/sos/sos.types';

dotenv.config();

// One-time backfill of `needsRecovery` onto existing SOS records, so the
// recovery scan's equality query can find them. Records that already carry
// the field are skipped; re-running is safe. Equality queries cannot find a
// missing field, so the collection is scanned by document ID.
//
// Safe to run against a live deployment: each update is conditional on the
// document being unchanged since it was read. A document written meanwhile
// went through SosRepository, which already set the field, so it is skipped.
//
// Usage: ts-node -r tsconfig-paths/register scripts/backfill-sos-needs-recovery.ts [startAfterDocId]

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
  const collection = db.collection(SOS_COLLECTION);
  let lastId = startAfterId;
  let scanned = 0;
  let updated = 0;
  let flagged = 0;
  let skipped = 0;

  for (;;) {
    let q = collection.orderBy(FieldPath.documentId()).limit(PAGE);
    if (lastId) q = q.startAfter(lastId);

    const snap = await q.get();
    if (snap.empty) break;

    let pageUpdates = 0;

    for (const doc of snap.docs) {
      const record = doc.data() as SosRecord;
      if (record.needsRecovery !== undefined) continue;
      const value = needsRecovery(record);
      try {
        await doc.ref.update({ needsRecovery: value }, { lastUpdateTime: doc.updateTime });
      } catch (error) {
        // FAILED_PRECONDITION: changed since read; the newer write is current.
        if ((error as { code?: number }).code !== 9) throw error;
        skipped++;
        continue;
      }
      pageUpdates++;
      if (value) flagged++;
    }

    scanned += snap.docs.length;
    updated += pageUpdates;
    lastId = snap.docs[snap.docs.length - 1].id;
    console.log(
      `Scanned ${scanned} (updated ${updated}, flagged ${flagged}, skipped ${skipped}); cursor=${lastId}`,
    );

    if (snap.docs.length < PAGE) break;
  }

  console.log(
    `Done. Scanned ${scanned} SOS records, updated ${updated}, flagged ${flagged} for recovery, skipped ${skipped} changed concurrently.`,
  );
}

const db = getFirestore(app());
backfill(db, process.argv[2]).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
