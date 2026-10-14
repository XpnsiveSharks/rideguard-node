import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import { Alert } from '../domain/alerts.entity';
import {
  INFERENCE_ALERT_COOLDOWN_SECONDS,
  INFERENCE_EVENT_RETENTION_DAYS,
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
  alert: Alert;
  /** Qualifying threat types in this event; never empty. */
  threats: InferenceThreat[];
  /** Node processing time, captured once so a transaction retry reuses it. */
  processedAt: Date;
};

export type InferenceAlertOutcome =
  | { outcome: 'alert_created'; alert: Alert }
  | { outcome: 'suppressed_cooldown' }
  | { outcome: 'duplicate' }
  | { outcome: 'event_conflict'; existingDeviceId: string };

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

  // Deduplicates the event, applies the per-camera cooldown and saves the
  // alert in one transaction. No network calls here: Firestore may rerun it.
  async createIfEligible(input: InferenceAlertInput): Promise<InferenceAlertOutcome> {
    const { eventId, alert, threats, processedAt } = input;
    const deviceId = alert.alertFields.deviceId;

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

      const lastAlertAt = (threat: InferenceThreat): Date | null =>
        (cooldown.get(LAST_ALERT_FIELD[threat]) as Timestamp | null | undefined)?.toDate() ?? null;

      if (!threats.some((threat) => isThreatEligible(lastAlertAt(threat), processedAt))) {
        // Suppressed events never move the cooldown.
        transaction.create(eventRef, {
          ...processedRecord,
          outcome: 'suppressed_cooldown',
          alertId: null,
        });
        return { outcome: 'suppressed_cooldown' as const };
      }

      const alertedAt = (threat: InferenceThreat): Timestamp | null =>
        threats.includes(threat)
          ? Timestamp.fromDate(processedAt)
          : ((cooldown.get(LAST_ALERT_FIELD[threat]) as Timestamp | undefined) ?? null);

      transaction.create(alertRef, AlertsMapper.toPersistence(alert));
      transaction.set(cooldownRef, {
        deviceId,
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
