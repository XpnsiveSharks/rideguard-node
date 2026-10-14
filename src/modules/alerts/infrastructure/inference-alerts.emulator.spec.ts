import { randomUUID } from 'crypto';
import { initializeApp, deleteApp, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import {
  InferenceAlertsRepository,
  INFERENCE_ALERT_COOLDOWNS_COLLECTION,
  PROCESSED_INFERENCE_EVENTS_COLLECTION,
  processedEventKey,
} from './inference-alerts.repository';

// Opt in only with a local Firestore emulator. Never use production credentials.
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const emulatorTests = emulatorHost ? describe : describe.skip;

emulatorTests('inference confirmation transaction contention (emulator)', () => {
  let app: App;
  let firestore: Firestore;
  let repository: InferenceAlertsRepository;
  let deviceId: string;
  let eventIds: string[];
  const baseTime = Date.now();

  beforeAll(() => {
    if (!/^(localhost|127\.0\.0\.1):\d+$/.test(emulatorHost ?? '')) {
      throw new Error('These tests require FIRESTORE_EMULATOR_HOST on localhost');
    }
    app = initializeApp({ projectId: 'demo-rideguard-confirmation' }, randomUUID());
    firestore = getFirestore(app);
    repository = new InferenceAlertsRepository(firestore);
  });

  beforeEach(() => {
    deviceId = `test-${randomUUID()}`;
    eventIds = [];
  });

  afterEach(async () => {
    const alerts = await firestore.collection('alerts').where('deviceId', '==', deviceId).get();
    const batch = firestore.batch();
    for (const alert of alerts.docs) batch.delete(alert.ref);
    for (const eventId of new Set(eventIds)) {
      batch.delete(
        firestore.collection(PROCESSED_INFERENCE_EVENTS_COLLECTION).doc(processedEventKey(eventId)),
      );
    }
    batch.delete(firestore.collection(INFERENCE_ALERT_COOLDOWNS_COLLECTION).doc(deviceId));
    await batch.commit();
  });

  afterAll(async () => {
    if (app) await deleteApp(app);
  });

  const handle = (eventId: string, offsetMs: number) => {
    eventIds.push(eventId);
    return repository.createIfEligible({
      eventId,
      deviceId,
      weaponLabels: ['gun'],
      hasFreshViolence: false,
      capturedAt: new Date(baseTime + offsetMs),
      processedAt: new Date(baseTime + offsetMs),
      imageUrl: null,
      observationVersion: 2,
    });
  };

  it('counts concurrent copies of one observation once', async () => {
    const eventId = randomUUID();
    const results = await Promise.all(Array.from({ length: 4 }, () => handle(eventId, 0)));
    expect(results.filter((result) => result.outcome === 'awaiting_confirmation')).toHaveLength(1);
    expect(results.filter((result) => result.outcome === 'duplicate')).toHaveLength(3);
    expect(
      (await firestore.collection('alerts').where('deviceId', '==', deviceId).get()).size,
    ).toBe(0);
    expect((await handle(randomUUID(), 1000)).outcome).toBe('alert_created');
  }, 30000);

  it('creates one alert when different confirming frames race', async () => {
    await handle(randomUUID(), 0);
    const results = await Promise.all([handle(randomUUID(), 1000), handle(randomUUID(), 2000)]);
    expect(results.filter((result) => result.outcome === 'alert_created')).toHaveLength(1);
    expect(
      (await firestore.collection('alerts').where('deviceId', '==', deviceId).get()).size,
    ).toBe(1);
  }, 30000);
});
