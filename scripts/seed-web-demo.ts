import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { UserRecord } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.FIREBASE_PROJECT_ID || '';
const allowedEnvironment = ['local', 'development'].includes(process.env.NODE_ENV || '');
const emulator = Boolean(
  process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST,
);
if (
  !allowedEnvironment ||
  process.env.RIDEGUARD_WEB_DEMO_SEED !== 'true' ||
  !projectId ||
  (!emulator && !projectId.toLowerCase().includes('demo'))
) {
  throw new Error(
    'Web demo seed refused: use an explicitly enabled local/development emulator or isolated demo Firebase project.',
  );
}

const app = initializeApp({
  projectId,
  ...(emulator
    ? {}
    : {
        credential: cert({
          projectId,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      }),
});
const auth = getAuth(app);
const db = getFirestore(app);
const remove = process.argv.includes('--remove');
const password = process.env.RIDEGUARD_WEB_DEMO_PASSWORD;
const adminPassword = process.env.RIDEGUARD_WEB_DEMO_ADMIN_PASSWORD;

const users = [
  {
    email: 'barangay34@demo.rideguard.local',
    name: 'Maria Santos',
    role: 'organization_manager',
    password,
  },
  {
    email: 'responder34@demo.rideguard.local',
    name: 'Juan Dela Cruz',
    role: 'organization_responder',
    password,
  },
  {
    email: 'admin@demo.rideguard.local',
    name: 'RideGuard Demo Administrator',
    role: 'admin',
    password: adminPassword,
  },
] as const;

async function ensureUser(input: (typeof users)[number]) {
  let existing: UserRecord | undefined;
  try {
    existing = await auth.getUserByEmail(input.email);
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
  }
  if (existing && existing.customClaims?.rideguardDemo !== true)
    throw new Error(`Refusing to modify non-demo account ${input.email}`);
  if (!existing && !input.password)
    throw new Error(`Missing development-only password for ${input.email}`);
  const user =
    existing ||
    (await auth.createUser({
      email: input.email,
      password: input.password,
      displayName: input.name,
      emailVerified: true,
    }));
  if (!existing)
    await auth.setCustomUserClaims(user.uid, { role: input.role, rideguardDemo: true });
  return user.uid;
}

async function ensureDocument(collection: string, id: string, value: Record<string, unknown>) {
  const ref = db.collection(collection).doc(id);
  const snapshot = await ref.get();
  if (snapshot.exists && snapshot.data()?.demo !== true)
    throw new Error(`Refusing to modify non-demo ${collection}/${id}`);
  if (!snapshot.exists) await ref.create({ ...value, demo: true });
}

async function removeDocument(collection: string, id: string) {
  const ref = db.collection(collection).doc(id);
  const snapshot = await ref.get();
  if (snapshot.exists && snapshot.data()?.demo === true) await ref.delete();
}

async function main() {
  if (remove) {
    for (const id of ['RG-DEMO-001', 'RG-DEMO-002', 'RG-DEMO-003'])
      await removeDocument('web_incidents', id);
    await removeDocument('web_locations', 'RG-DEMO-LOCATION-003');
    for (const input of users) {
      try {
        const user = await auth.getUserByEmail(input.email);
        if (user.customClaims?.rideguardDemo === true) {
          await removeDocument('web_memberships', user.uid);
          await auth.deleteUser(user.uid);
        }
      } catch (error) {
        if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
      }
    }
    await removeDocument('web_organizations', 'demo-barangay-34');
    console.log('Removed marked web demo records only.');
    return;
  }

  const ids = await Promise.all(users.map(ensureUser));
  const orgId = 'demo-barangay-34';
  await ensureDocument('web_organizations', orgId, {
    id: orgId,
    name: 'Barangay 34',
    type: 'barangay',
    city: 'Caloocan City',
    region: 'Metro Manila',
    barangay: 'Barangay 34',
    address: 'Fictional demonstration office',
    officialEmail: users[0].email,
    status: 'active',
  });
  await ensureDocument('web_memberships', ids[0], {
    uid: ids[0],
    organizationId: orgId,
    role: 'organization_manager',
    status: 'active',
  });
  await ensureDocument('web_memberships', ids[1], {
    uid: ids[1],
    organizationId: orgId,
    role: 'organization_responder',
    status: 'active',
  });
  const now = Date.now();
  const cases = [
    { id: 'RG-DEMO-001', type: 'suspected_violence', status: 'new' },
    { id: 'RG-DEMO-002', type: 'possible_weapon', status: 'acknowledged' },
    { id: 'RG-DEMO-003', type: 'sos', status: 'in_progress' },
  ];
  for (const item of cases)
    await ensureDocument('web_incidents', item.id, {
      ...item,
      organizationId: orgId,
      driverId: 'fictional-demo-driver',
      createdAt: new Date(now - 60 * 60_000).toISOString(),
      timeline: [
        {
          id: `${item.id}-created`,
          label: 'Simulation incident created',
          createdAt: new Date(now - 60 * 60_000).toISOString(),
        },
      ],
      notes: [],
      evidence: [
        { id: `${item.id}-evidence`, label: 'Simulated evidence metadata', available: false },
      ],
    });
  await ensureDocument('web_locations', 'RG-DEMO-LOCATION-003', {
    id: 'RG-DEMO-LOCATION-003',
    incidentId: 'RG-DEMO-003',
    organizationId: orgId,
    latitude: 14.661,
    longitude: 120.984,
    accuracyMeters: 25,
    capturedAt: new Date(now - 60_000).toISOString(),
    receivedAt: new Date(now - 60_000).toISOString(),
    status: 'active',
    simulation: true,
  });
  console.log(
    'Web demo records are ready in the isolated development project. Existing demo credentials were not changed.',
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
