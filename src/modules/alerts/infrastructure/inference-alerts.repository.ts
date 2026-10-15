import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import { Alert } from '../domain/alerts.entity';
import {
  INFERENCE_ALERT_COOLDOWN_SECONDS,
  INFERENCE_EVENT_RETENTION_DAYS,
  INFERENCE_OBSERVATION_MAX_AGE_SECONDS,
  INFERENCE_CLOCK_SKEW_SECONDS,
  WEAPON_CONFIRMATION_FRAME_COUNT,
  WEAPON_CONFIRMATION_REQUIRED_HITS,
  WEAPON_CONFIRMATION_WINDOW_SECONDS,
} from '../alerts.constants';
import { ALERTS_COLLECTION, AlertsMapper } from './alerts.mapper';

export const PROCESSED_INFERENCE_EVENTS_COLLECTION = 'processed_inference_events';
export const INFERENCE_ALERT_COOLDOWNS_COLLECTION = 'inference_alert_cooldowns';

const DAY_MS = 24 * 60 * 60 * 1000;

export type InferenceThreat = 'weapon' | 'violence';

const LAST_ALERT_FIELD: Record<InferenceThreat, string> = {
  weapon: 'weaponLastAlertAt',
  violence: 'violenceLastAlertAt',
};

export type InferenceAlertInput = {
  eventId: string;
  deviceId: string;
  capturedAt: Date;
  imageUrl: string | null;
  videoUrl: string | null;
  weaponLabels: string[];
  hasFreshViolence: boolean;
  /** Only v2 producers publish negative observations as well as positives. */
  observationVersion?: 2;
  /** Node processing time, captured once so a transaction retry reuses it. */
  processedAt: Date;
};

export type InferenceAlertOutcome =
  | { outcome: 'alert_created'; alert: Alert }
  | { outcome: 'suppressed_cooldown' }
  | { outcome: 'awaiting_confirmation' }
  | { outcome: 'awaiting_observations' }
  | { outcome: 'ignored_no_threat' }
  | { outcome: 'ignored_stale' }
  | { outcome: 'duplicate' }
  | { outcome: 'event_conflict'; existingDeviceId: string };

type WeaponObservation = { observedAt: Timestamp; labels: string[] };

// Event IDs are arbitrary nonempty strings, so hash them into safe document IDs.
export function processedEventKey(eventId: string): string {
  return createHash('sha256').update(`inference.result:${eventId}`).digest('hex');
}

// Eligible when the type never alerted, or at/after the end of its cooldown.
export function isThreatEligible(lastAlertAt: Date | null, now: Date): boolean {
  return (
    lastAlertAt === null ||
    now.getTime() >= lastAlertAt.getTime() + INFERENCE_ALERT_COOLDOWN_SECONDS * 1000
  );
}

@Injectable()
export class InferenceAlertsRepository {
  constructor(@Inject(FIREBASE_FIRESTORE) private readonly firestore: Firestore) {}

  // Deduplicates the event, confirms weapons, applies the cooldown and saves the
  // alert in one transaction. No network calls here: Firestore may rerun it.
  async createIfEligible(input: InferenceAlertInput): Promise<InferenceAlertOutcome> {
    const { eventId, deviceId, processedAt, capturedAt } = input;

    const eventRef = this.firestore
      .collection(PROCESSED_INFERENCE_EVENTS_COLLECTION)
      .doc(processedEventKey(eventId));
    const cooldownRef = this.firestore
      .collection(INFERENCE_ALERT_COOLDOWNS_COLLECTION)
      .doc(deviceId);
    const alertRef = this.firestore.collection(ALERTS_COLLECTION).doc();

    const processedRecord = {
      eventId,
      deviceId,
      processedAt: Timestamp.fromDate(processedAt),
      expiresAt: Timestamp.fromDate(
        new Date(processedAt.getTime() + INFERENCE_EVENT_RETENTION_DAYS * DAY_MS),
      ),
    };

    return this.firestore.runTransaction(async (transaction) => {
      // All reads before any write.
      const [event, cooldown] = await transaction.getAll(eventRef, cooldownRef);

      // An existing key is processed whatever its expiresAt: TTL is lazy cleanup.
      if (event.exists) {
        const existingDeviceId = event.get('deviceId') as string;
        return existingDeviceId === deviceId
          ? { outcome: 'duplicate' as const }
          : { outcome: 'event_conflict' as const, existingDeviceId };
      }

      const previous = cooldown.data() ?? {};
      const labels = [
        ...new Set(input.weaponLabels.map((label) => label.trim().toLowerCase())),
      ].filter((label) => label === 'gun' || label === 'knife');
      let weaponConfirmed = false;
      let observationFields = {};

      if (input.observationVersion === 2) {
        const observedMs = capturedAt.getTime();
        const ageMs = processedAt.getTime() - observedMs;
        const lastObservedAt = previous.lastWeaponObservedAt as Timestamp | undefined;
        if (
          !Number.isFinite(observedMs) ||
          ageMs > INFERENCE_OBSERVATION_MAX_AGE_SECONDS * 1000 ||
          ageMs < -INFERENCE_CLOCK_SKEW_SECONDS * 1000 ||
          (lastObservedAt && observedMs <= lastObservedAt.toMillis())
        ) {
          transaction.create(eventRef, {
            ...processedRecord,
            outcome: 'ignored_stale',
            alertId: null,
          });
          return { outcome: 'ignored_stale' as const };
        }

        const history = (previous.weaponObservations ?? []) as WeaponObservation[];
        const observations = [
          ...history.filter(
            (frame) =>
              observedMs - frame.observedAt.toMillis() <= WEAPON_CONFIRMATION_WINDOW_SECONDS * 1000,
          ),
          { observedAt: Timestamp.fromDate(capturedAt), labels },
        ].slice(-WEAPON_CONFIRMATION_FRAME_COUNT);

        // Current frame must be positive. Multiple boxes of one class count once.
        weaponConfirmed = labels.some(
          (label) =>
            observations.filter((frame) => frame.labels.includes(label)).length >=
            WEAPON_CONFIRMATION_REQUIRED_HITS,
        );
        observationFields = {
          lastWeaponObservedAt: Timestamp.fromDate(capturedAt),
          weaponObservations: observations,
        };
      }

      const threats: InferenceThreat[] = [];
      if (weaponConfirmed) threats.push('weapon');
      if (input.hasFreshViolence) threats.push('violence');
      const state = { ...previous, deviceId, ...observationFields };

      if (threats.length === 0) {
        const outcome =
          labels.length === 0
            ? 'ignored_no_threat'
            : input.observationVersion === 2
              ? 'awaiting_confirmation'
              : 'awaiting_observations';
        if (input.observationVersion === 2) transaction.set(cooldownRef, state);
        transaction.create(eventRef, { ...processedRecord, outcome, alertId: null });
        return { outcome };
      }

      const lastAlertAt = (threat: InferenceThreat): Date | null =>
        (cooldown.get(LAST_ALERT_FIELD[threat]) as Timestamp | null | undefined)?.toDate() ?? null;

      if (!threats.some((threat) => isThreatEligible(lastAlertAt(threat), processedAt))) {
        // Keep fresh observations even during cooldown; never move alert times.
        if (input.observationVersion === 2) transaction.set(cooldownRef, state);
        transaction.create(eventRef, {
          ...processedRecord,
          outcome: 'suppressed_cooldown',
          alertId: null,
        });
        return { outcome: 'suppressed_cooldown' as const };
      }

      const alertedAt = (threat: InferenceThreat): Timestamp | null =>
        threats.includes(threat)
          ? Timestamp.fromMillis(
              Math.max(processedAt.getTime(), lastAlertAt(threat)?.getTime() ?? 0),
            )
          : ((cooldown.get(LAST_ALERT_FIELD[threat]) as Timestamp | undefined) ?? null);

      const alert = Alert.create({
        deviceId,
        message:
          weaponConfirmed && input.hasFreshViolence
            ? 'Possible violence and weapon detected'
            : weaponConfirmed
              ? 'Weapon detected'
              : 'Possible violence detected',
        imageUrl: input.imageUrl,
        // Media never independently qualifies a threat: only attach the clip
        // when this alert actually includes qualifying violence.
        videoUrl: threats.includes('violence') ? input.videoUrl : null,
        timeStamp: capturedAt,
        isFalseAlarm: false,
        isSeen: false,
      });

      transaction.create(alertRef, AlertsMapper.toPersistence(alert));
      transaction.set(cooldownRef, {
        ...state,
        weaponLastAlertAt: alertedAt('weapon'),
        violenceLastAlertAt: alertedAt('violence'),
      });
      transaction.create(eventRef, {
        ...processedRecord,
        outcome: 'alert_created',
        alertId: alertRef.id,
      });

      return {
        outcome: 'alert_created' as const,
        alert: Alert.create({ ...alert.alertFields, alertId: alertRef.id }),
      };
    });
  }
}
