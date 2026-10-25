import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore, Query } from 'firebase-admin/firestore';
import { FieldPath } from 'firebase-admin/firestore';
import { FIREBASE_AUTH, FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import type { EnvironmentVariables } from '@/config/env.validation';

const INTERVAL_MS = 60 * 1000; // every 60 seconds

@Injectable()
export class AccountDeletionProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountDeletionProcessorService.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;

  constructor(
    @Inject(FIREBASE_AUTH) private readonly auth: Auth,
    @Inject(FIREBASE_FIRESTORE) private readonly firestore: Firestore,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  onModuleInit(): void {
    if (!this.configService.get('ACCOUNT_DELETION_ENABLED', { infer: true })) {
      this.logger.log('Account deletion processor is disabled (ACCOUNT_DELETION_ENABLED=false).');
      return;
    }

    void this.run();
    this.intervalHandle = setInterval(() => void this.run(), INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async run(): Promise<void> {
    if (this.isProcessing) {
      this.logger.debug('Account deletion run skipped — previous run still in progress.');
      return;
    }

    this.isProcessing = true;
    try {
      const now = new Date();
      const snapshot = await this.firestore
        .collection('profiles')
        .where('deletionScheduledAt', '<=', now)
        .get();

      if (snapshot.empty) return;

      let totalDeleted = 0;
      for (const doc of snapshot.docs) {
        const uid = doc.id;
        try {
          await this.purgeUserData(uid, doc.data());
          totalDeleted++;
        } catch (err) {
          this.logger.error(`Account deletion failed for uid=${uid}: ${(err as Error).message}`);
        }
      }

      if (totalDeleted > 0) {
        this.logger.log(`Account deletion run complete: purged ${totalDeleted} account(s).`);
      }
    } catch (err) {
      this.logger.error(`Account deletion run failed: ${(err as Error).message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  async purgeUserData(uid: string, profileData?: Record<string, unknown>): Promise<void> {
    // 1. emergency_contacts
    await this.deleteByQuery(
      this.firestore.collection('emergency_contacts').where('uid', '==', uid),
    );

    // 2. push_registrations
    await this.deleteByQuery(
      this.firestore.collection('push_registrations').where('userId', '==', uid),
    );

    // 3. phone-sessions
    await this.deleteByQuery(
      this.firestore.collection('phone-sessions').where('userId', '==', uid),
    );

    // 4. sos
    await this.deleteByQuery(this.firestore.collection('sos').where('uid', '==', uid));

    // 5. sos_active
    await this.firestore
      .collection('sos_active')
      .doc(uid)
      .delete()
      .catch(() => undefined);

    // 6. sos_requests
    await this.deleteByQuery(
      this.firestore
        .collection('sos_requests')
        .where(FieldPath.documentId(), '>=', `${uid}_`)
        .where(FieldPath.documentId(), '<=', `${uid}_\uf8ff`),
    );

    // 7. devices
    const devicesSnap = await this.firestore
      .collection('devices')
      .where('assignedUserId', '==', uid)
      .get();
    for (const doc of devicesSnap.docs) {
      const data = doc.data();
      if (doc.id.startsWith('CAM-') && data.source === 'phone') {
        await doc.ref.delete().catch(() => undefined);
      } else {
        await doc.ref.update({ assignedUserId: null }).catch(() => undefined);
      }
    }

    // 8. usernames
    const username = (profileData?.username as string) ?? undefined;
    if (username) {
      const usernameDoc = await this.firestore.collection('usernames').doc(username).get();
      if (usernameDoc.exists && usernameDoc.data()?.uid === uid) {
        await usernameDoc.ref.delete().catch(() => undefined);
      }
    }
    await this.deleteByQuery(this.firestore.collection('usernames').where('uid', '==', uid));

    // 9. pending_registrations
    await this.deleteByQuery(
      this.firestore.collection('pending_registrations').where('uid', '==', uid),
    );

    // 10. Firebase Auth user
    try {
      await this.auth.deleteUser(uid);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'auth/user-not-found') {
        throw err;
      }
    }

    // 11. Profile document
    await this.firestore.collection('profiles').doc(uid).delete();
  }

  private async deleteByQuery(query: Query): Promise<number> {
    const snapshot = await query.get();
    if (snapshot.empty) return 0;
    const batch = this.firestore.batch();
    for (const doc of snapshot.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    return snapshot.size;
  }
}
