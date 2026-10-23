import { BadRequestException, Injectable, Inject, NotFoundException } from '@nestjs/common';
import { FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import { FieldPath, FieldValue, Firestore } from 'firebase-admin/firestore';
import { Alert, AlertFields } from '../domain/alerts.entity';
import { ALERTS_COLLECTION, AlertsMapper } from './alerts.mapper';
import { PROFILES_COLLECTION } from '@/modules/profile/infrastructure/profile.document';
import { DEVICES_COLLECTION } from '@/modules/devices/infrastructure/devices.mapper';

// Firestore `in` is capped at 30 operands; chunk device IDs to that size.
const DEVICE_IN_CHUNK = 30;

// Preference values that mean auto-archive is active. Anything else (null /
// missing / unexpected) means Never, so no alert is archived.
const ACTIVE_HOURS = new Set([24, 48, 72]);

type ArchiveHours = 24 | 48 | 72;

function toDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  const date = new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

@Injectable()
export class AlertsRepository {
  constructor(@Inject(FIREBASE_FIRESTORE) private readonly firestoreClient: Firestore) {}

  async findNonFalseAlarmsByDeviceId(
    deviceIds: string[],
    limit: number,
    cursor?: string,
    status?: 'active' | 'archived',
  ): Promise<{ data: Alert[]; nextCursor: string | null }> {
    if (deviceIds.length === 0) {
      return { data: [], nextCursor: null };
    }

    const alertsCollection = this.firestoreClient.collection(ALERTS_COLLECTION);
    let query = alertsCollection
      .where('deviceId', 'in', deviceIds)
      .where('isFalseAlarm', '==', false);

    if (status === 'active') {
      query = query.where('isArchived', '==', false);
    } else if (status === 'archived') {
      query = query.where('isArchived', '==', true);
    }

    query = query.orderBy('timeStamp', 'desc').orderBy(FieldPath.documentId(), 'desc');

    if (cursor) {
      const cursorDocument = await alertsCollection.doc(cursor).get();
      const cursorData = cursorDocument.data() as AlertFields | undefined;

      if (
        !cursorDocument.exists ||
        !cursorData ||
        cursorData.isFalseAlarm !== false ||
        !deviceIds.includes(cursorData.deviceId)
      ) {
        throw new BadRequestException('The alert cursor is invalid.');
      }

      query = query.startAfter(cursorDocument);
    }

    const querySnapshot = await query.limit(limit + 1).get();
    const hasMore = querySnapshot.docs.length > limit;
    const pageDocuments = querySnapshot.docs.slice(0, limit);

    return {
      data: pageDocuments.map((doc) => AlertsMapper.toDomain(doc.id, doc.data() as AlertFields)),
      nextCursor: hasMore ? (pageDocuments.at(-1)?.id ?? null) : null,
    };
  }

  private async findOwnedData(alertId: string, deviceIds: string[]): Promise<AlertFields> {
    const alertSnapshot = await this.firestoreClient
      .collection(ALERTS_COLLECTION)
      .doc(alertId)
      .get();
    const alertData = alertSnapshot.data() as AlertFields | undefined;

    if (!alertSnapshot.exists || !alertData || !deviceIds.includes(alertData.deviceId)) {
      throw new NotFoundException('Alert not found.');
    }

    return alertData;
  }

  async getOwned(alertId: string, deviceIds: string[]): Promise<Alert> {
    return AlertsMapper.toDomain(alertId, await this.findOwnedData(alertId, deviceIds));
  }

  async updateIsSeen(alertId: string, deviceIds: string[], isSeen: boolean): Promise<Alert> {
    const alertData = await this.findOwnedData(alertId, deviceIds);
    await this.firestoreClient.collection(ALERTS_COLLECTION).doc(alertId).update({ isSeen });

    return AlertsMapper.toDomain(alertId, { ...alertData, isSeen });
  }

  async updateIsFalseAlarm(
    alertId: string,
    deviceIds: string[],
    isFalseAlarm: boolean,
  ): Promise<Alert> {
    const alertData = await this.findOwnedData(alertId, deviceIds);
    await this.firestoreClient.collection(ALERTS_COLLECTION).doc(alertId).update({ isFalseAlarm });

    return AlertsMapper.toDomain(alertId, { ...alertData, isFalseAlarm });
  }

  /**
   * Archives due alerts for one account. Candidate selection is a cheap,
   * bounded query; the archive write for each candidate is a transaction that
   * re-reads the authoritative state (see {@link archiveOneIfDue}), so a stale
   * candidate is never archived. `limit` bounds the work per pass; because an
   * archived alert drops out of the candidate query, the next pass continues
   * where this one stopped. Returns the counts for logging.
   */
  async archiveDueAlerts(params: {
    uid: string;
    deviceIds: string[];
    autoArchiveHours: ArchiveHours;
    now: Date;
    limit: number;
  }): Promise<{ archived: number; scanned: number }> {
    const { uid, deviceIds, autoArchiveHours, now, limit } = params;
    if (deviceIds.length === 0 || limit <= 0) return { archived: 0, scanned: 0 };

    const collection = this.firestoreClient.collection(ALERTS_COLLECTION);
    // Candidate cutoff from the scan-time preference. The transaction re-reads
    // the current preference and recomputes the authoritative cutoff, so a
    // preference extended in the meantime is still honored per candidate.
    const cutoff = new Date(now.getTime() - autoArchiveHours * 3_600_000);

    const candidateIds: string[] = [];
    for (let i = 0; i < deviceIds.length && candidateIds.length < limit; i += DEVICE_IN_CHUNK) {
      const chunk = deviceIds.slice(i, i + DEVICE_IN_CHUNK);
      const snapshot = await collection
        .where('deviceId', 'in', chunk)
        .where('isFalseAlarm', '==', false)
        .where('isArchived', '==', false)
        .where('createdAt', '<=', cutoff)
        .orderBy('createdAt', 'asc')
        .limit(limit - candidateIds.length)
        .get();
      snapshot.docs.forEach((doc) => candidateIds.push(doc.id));
    }

    let archived = 0;
    for (const alertId of candidateIds) {
      if (await this.archiveOneIfDue(alertId, uid, now)) archived++;
    }

    return { archived, scanned: candidateIds.length };
  }

  /**
   * Archives a single alert only if it is still eligible, in one transaction.
   * Re-reads, inside the transaction, before writing:
   *  - the alert (skip if gone, already archived, or now a false alarm),
   *  - the account preference (skip if now Never / not an active period),
   *  - the device assignment (skip if the device is no longer owned by `uid`),
   *  - the due time against the re-read preference (skip if not yet due).
   * Returns true only when it set `isArchived`/`archivedAt`. An alert already
   * archived by a concurrent worker is left untouched, so its original
   * `archivedAt` is preserved. Idempotent and safe under duplicate workers.
   */
  async archiveOneIfDue(alertId: string, uid: string, now: Date): Promise<boolean> {
    const alertRef = this.firestoreClient.collection(ALERTS_COLLECTION).doc(alertId);
    const profileRef = this.firestoreClient.collection(PROFILES_COLLECTION).doc(uid);

    return this.firestoreClient.runTransaction(async (transaction) => {
      const alertSnapshot = await transaction.get(alertRef);
      const alert = alertSnapshot.data() as AlertFields | undefined;
      if (!alertSnapshot.exists || !alert) return false;
      // Already archived (possibly by a duplicate worker) — never overwrite
      // archivedAt. A record flagged a false alarm is excluded from archiving.
      if (alert.isArchived === true || alert.isFalseAlarm !== false) return false;

      const profileSnapshot = await transaction.get(profileRef);
      const hours = profileSnapshot.data()?.autoArchiveHours as number | null | undefined;
      if (typeof hours !== 'number' || !ACTIVE_HOURS.has(hours)) return false;

      const deviceRef = this.firestoreClient.collection(DEVICES_COLLECTION).doc(alert.deviceId);
      const deviceSnapshot = await transaction.get(deviceRef);
      if (!deviceSnapshot.exists || deviceSnapshot.get('assignedUserId') !== uid) return false;

      const createdAt = toDate(alert.createdAt) ?? toDate(alert.timeStamp);
      if (!createdAt) return false;
      const cutoff = now.getTime() - hours * 3_600_000;
      if (createdAt.getTime() > cutoff) return false;

      transaction.update(alertRef, {
        isArchived: true,
        archivedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
  }
}
