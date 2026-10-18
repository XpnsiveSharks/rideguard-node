import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';

dotenv.config();

const CONTACTS_COLLECTION = 'emergency_contacts';
const PROFILES_COLLECTION = 'profiles';
const MIGRATION_MARKER = 'legacy-profile-emergency-contact-v1';

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

async function forward(db: FirebaseFirestore.Firestore) {
  const profiles = await db.collection(PROFILES_COLLECTION).get();
  let migrated = 0;
  for (const profile of profiles.docs) {
    const legacy = profile.get('emergencyContact') as
      | {
          emergencyContactName?: string;
          phoneNumber?: string;
          emergencyContactRelationship?: string;
        }
      | undefined;
    if (!legacy || (!legacy.emergencyContactName && !legacy.phoneNumber)) continue;
    const contact = db.collection(CONTACTS_COLLECTION).doc();
    await contact.create({
      id: contact.id,
      uid: profile.id,
      name: legacy.emergencyContactName ?? '',
      phone: legacy.phoneNumber ?? '',
      relationship: legacy.emergencyContactRelationship ?? 'Other',
      photo_url: null,
      public_id: null,
      migration_marker: MIGRATION_MARKER,
      legacy_profile_emergency_contact: legacy,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await profile.ref.update({
      emergencyContact: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    migrated++;
  }
  console.log(`Migrated ${migrated} profiles.`);
}

async function back(db: FirebaseFirestore.Firestore) {
  const contacts = await db
    .collection(CONTACTS_COLLECTION)
    .where('migration_marker', '==', MIGRATION_MARKER)
    .get();
  let rolledBack = 0;
  for (const contact of contacts.docs) {
    const contactData = contact.data() as Record<string, unknown>;
    const legacy = contactData.legacy_profile_emergency_contact as
      Record<string, unknown> | undefined;
    const uid = contactData.uid;
    if (!legacy || typeof uid !== 'string') continue;
    await db.collection(PROFILES_COLLECTION).doc(uid).update({
      emergencyContact: legacy,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await contact.ref.delete();
    rolledBack++;
  }
  console.log(`Rolled back ${rolledBack} contacts.`);
}

const direction = process.argv[2];
if (direction !== 'up' && direction !== 'down') {
  throw new Error('Usage: ts-node scripts/migrate-emergency-contacts.ts up|down');
}

const db = getFirestore(app());
(direction === 'up' ? forward(db) : back(db)).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
