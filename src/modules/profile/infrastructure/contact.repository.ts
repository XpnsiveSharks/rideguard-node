import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { FieldValue, Firestore } from 'firebase-admin/firestore';
import { FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';

export interface EmergencyContactRecord {
  id: string;
  uid: string;
  name: string;
  phone: string;
  email: string;
  relationship: string;
  photo_url: string | null;
  public_id: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

const CONTACTS_COLLECTION = 'emergency_contacts';

@Injectable()
export class ContactRepository {
  constructor(@Inject(FIREBASE_FIRESTORE) private readonly firestore: Firestore) {}

  async create(
    uid: string,
    input: Omit<EmergencyContactRecord, 'id' | 'uid' | 'createdAt' | 'updatedAt'>,
  ): Promise<EmergencyContactRecord> {
    const reference = this.firestore.collection(CONTACTS_COLLECTION).doc();
    const record = { id: reference.id, uid, ...input };
    await reference.create({
      ...record,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return record;
  }

  async list(uid: string): Promise<EmergencyContactRecord[]> {
    const snapshot = await this.firestore
      .collection(CONTACTS_COLLECTION)
      .where('uid', '==', uid)
      .get();
    return snapshot.docs.map((document) => document.data() as EmergencyContactRecord);
  }

  async findOwned(uid: string, id: string): Promise<EmergencyContactRecord> {
    const snapshot = await this.firestore.collection(CONTACTS_COLLECTION).doc(id).get();
    if (!snapshot.exists || snapshot.get('uid') !== uid) {
      throw new NotFoundException('Emergency contact not found');
    }
    return snapshot.data() as EmergencyContactRecord;
  }

  async update(
    uid: string,
    id: string,
    input: Partial<Omit<EmergencyContactRecord, 'id' | 'uid' | 'createdAt' | 'updatedAt'>>,
  ): Promise<EmergencyContactRecord> {
    await this.findOwned(uid, id);
    await this.firestore
      .collection(CONTACTS_COLLECTION)
      .doc(id)
      .update({
        ...input,
        updatedAt: FieldValue.serverTimestamp(),
      });
    return this.findOwned(uid, id);
  }

  async delete(uid: string, id: string): Promise<EmergencyContactRecord> {
    const contact = await this.findOwned(uid, id);
    await this.firestore.collection(CONTACTS_COLLECTION).doc(id).delete();
    return contact;
  }
}
