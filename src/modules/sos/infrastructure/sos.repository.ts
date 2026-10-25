import { Inject, Injectable } from '@nestjs/common';
import { FieldPath, Firestore } from 'firebase-admin/firestore';
import { FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import { SOS_ACTIVE_COLLECTION, SOS_COLLECTION, SOS_REQUESTS_COLLECTION } from '../sos.constants';
import type { SosRecord } from '../sos.types';
import { updateDeliveryDue } from '../sos-delivery';

type RequestMapping = { sosId: string; fingerprint: string };

export type StartOutcome =
  | { kind: 'created'; record: SosRecord }
  | { kind: 'existing'; record: SosRecord }
  | { kind: 'conflict' };

const requestKey = (uid: string, requestId: string): string => `${uid}_${requestId}`;

// Firestore access for manual SOS. Provider calls never happen inside any of
// these transactions.
@Injectable()
export class SosRepository {
  constructor(@Inject(FIREBASE_FIRESTORE) private readonly firestore: Firestore) {}

  async findByRequest(
    uid: string,
    requestId: string,
  ): Promise<{ record: SosRecord; fingerprint: string } | null> {
    const mapping = await this.firestore
      .collection(SOS_REQUESTS_COLLECTION)
      .doc(requestKey(uid, requestId))
      .get();
    if (!mapping.exists) return null;
    const { sosId, fingerprint } = mapping.data() as RequestMapping;
    const record = await this.get(sosId);
    return record?.uid === uid ? { record, fingerprint } : null;
  }

  async get(sosId: string): Promise<SosRecord | null> {
    const snapshot = await this.firestore.collection(SOS_COLLECTION).doc(sosId).get();
    return snapshot.exists ? (snapshot.data() as SosRecord) : null;
  }

  async getActive(uid: string): Promise<SosRecord | null> {
    const pointer = await this.firestore.collection(SOS_ACTIVE_COLLECTION).doc(uid).get();
    if (!pointer.exists) return null;
    const record = await this.get((pointer.data() as { sosId: string }).sosId);
    return record?.status === 'active' ? record : null;
  }

  async findLatestByAlert(uid: string, alertId: string): Promise<SosRecord | null> {
    // A single-field query avoids requiring new index configuration. Filter
    // ownership and choose the latest creation locally, including ended SOS.
    const snapshot = await this.firestore
      .collection(SOS_COLLECTION)
      .where('alertId', '==', alertId)
      .get();
    let latest: SosRecord | null = null;
    for (const doc of snapshot.docs) {
      const record = doc.data() as SosRecord;
      if (record.uid !== uid) continue;
      if (
        !latest ||
        Date.parse(record.createdAt) > Date.parse(latest.createdAt) ||
        (record.createdAt === latest.createdAt && record.sosId > latest.sosId)
      )
        latest = record;
    }
    return latest;
  }

  // Binds the request id, reserves the user's single active SOS and creates
  // the record in one transaction. If a SOS is already active the request id
  // is mapped to it and that SOS is returned unchanged.
  async startOrGet(
    uid: string,
    requestId: string,
    fingerprint: string,
    candidate: SosRecord,
  ): Promise<StartOutcome> {
    const requestRef = this.firestore
      .collection(SOS_REQUESTS_COLLECTION)
      .doc(requestKey(uid, requestId));
    const activeRef = this.firestore.collection(SOS_ACTIVE_COLLECTION).doc(uid);
    const sosCollection = this.firestore.collection(SOS_COLLECTION);

    return this.firestore.runTransaction(async (transaction): Promise<StartOutcome> => {
      const [requestDoc, activeDoc] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(activeRef),
      ]);

      if (requestDoc.exists) {
        const mapping = requestDoc.data() as RequestMapping;
        if (mapping.fingerprint !== fingerprint) return { kind: 'conflict' };
        const existing = await transaction.get(sosCollection.doc(mapping.sosId));
        return { kind: 'existing', record: existing.data() as SosRecord };
      }

      if (activeDoc.exists) {
        const activeId = (activeDoc.data() as { sosId: string }).sosId;
        const activeSos = await transaction.get(sosCollection.doc(activeId));
        const active = activeSos.data() as SosRecord | undefined;
        if (active?.status === 'active') {
          transaction.set(requestRef, { sosId: activeId, fingerprint });
          return { kind: 'existing', record: active };
        }
      }

      transaction.set(sosCollection.doc(candidate.sosId), candidate);
      transaction.set(activeRef, { sosId: candidate.sosId });
      transaction.set(requestRef, { sosId: candidate.sosId, fingerprint });
      return { kind: 'created', record: candidate };
    });
  }

  newId(): string {
    return this.firestore.collection(SOS_COLLECTION).doc().id;
  }

  async listDeliveryDue(now: number): Promise<SosRecord[]> {
    const page = await this.firestore.collection(SOS_COLLECTION)
      .where('deliveryDueAt', '<=', now).orderBy('deliveryDueAt').limit(50).get();
    return page.docs.map(doc => doc.data() as SosRecord);
  }

  // Account cooldown and message claim are read together before any writes.
  async mutateTracking<T>(sosId: string, change: (record: SosRecord, cooldown: { until: number }) => T): Promise<T | null> {
    const ref = this.firestore.collection(SOS_COLLECTION).doc(sosId);
    const cooldownRef = this.firestore.collection('sos_delivery_control').doc('textbee');
    return this.firestore.runTransaction(async transaction => {
      const [snapshot, control] = await Promise.all([transaction.get(ref), transaction.get(cooldownRef)]);
      if (!snapshot.exists) return null;
      const record = snapshot.data() as SosRecord;
      const cooldown = { until: Number(control.data()?.until ?? 0) };
      const previous = cooldown.until;
      const result = change(record, cooldown);
      updateDeliveryDue(record);
      transaction.set(ref, record);
      if (previous !== cooldown.until) transaction.set(cooldownRef, cooldown);
      return result;
    });
  }

  // Document-ID paging needs no new index and includes ended SOS records.
  async listPage(afterId?: string): Promise<SosRecord[]> {
    let query = this.firestore
      .collection(SOS_COLLECTION)
      .orderBy(FieldPath.documentId())
      .limit(100);
    if (afterId) query = query.startAfter(afterId);
    const page = await query.get();
    return page.docs.map((doc) => doc.data() as SosRecord);
  }

  // Read-modify-write on one SOS inside a transaction. `change` may mutate
  // the record and returns a value for the caller; it must be pure (it can be
  // retried by Firestore).
  async mutate<T>(sosId: string, change: (record: SosRecord) => T): Promise<T | null> {
    const ref = this.firestore.collection(SOS_COLLECTION).doc(sosId);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return null;
      const record = snapshot.data() as SosRecord;
      const result = change(record);
      updateDeliveryDue(record);
      transaction.set(ref, record);
      return result;
    });
  }

  // Like `mutate`, but also clears the user's active pointer when it still
  // references this SOS.
  async mutateAndRelease<T>(
    uid: string,
    sosId: string,
    change: (record: SosRecord) => T,
  ): Promise<T | null> {
    const ref = this.firestore.collection(SOS_COLLECTION).doc(sosId);
    const activeRef = this.firestore.collection(SOS_ACTIVE_COLLECTION).doc(uid);
    return this.firestore.runTransaction(async (transaction) => {
      const [snapshot, activeDoc] = await Promise.all([
        transaction.get(ref),
        transaction.get(activeRef),
      ]);
      if (!snapshot.exists) return null;
      const record = snapshot.data() as SosRecord;
      const result = change(record);
      updateDeliveryDue(record);
      transaction.set(ref, record);
      if (activeDoc.exists && (activeDoc.data() as { sosId: string }).sosId === sosId) {
        transaction.delete(activeRef);
      }
      return result;
    });
  }
}
