import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  HttpException,
  HttpStatus,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { FIREBASE_AUTH, FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import type { Auth } from 'firebase-admin/auth';
import {
  MPIN_ACCOUNTS,
  MPIN_ATTEMPT_LIMIT,
  MPIN_CHALLENGES,
  MPIN_CODE_ATTEMPT_LIMIT,
  MPIN_CODE_MS,
  MPIN_GRANT_MS,
  MPIN_GRANTS,
  MPIN_DEFAULT_DEEP_LINK_BASE_URL,
  MPIN_HISTORY_LIMIT,
  MPIN_INACTIVITY_TIMEOUT_MS,
  MPIN_LOCK_MS,
  MPIN_RESEND_MS,
  MPIN_UNLOCKS,
  MPIN_UNLOCK_MS,
} from './mpin.constants';
import type { MpinStatusContextDto } from './mpin.dto';

const scrypt = promisify(scryptCallback);

type Account = {
  pinHash?: string;
  pinHistory?: string[];
  failedAttempts?: number;
  lockedUntil?: number;
  unlockExpiresAt?: number;
  changeLockUntil?: number;
};

type Challenge = {
  uid: string;
  purpose: 'change-code' | 'recovery';
  codeHash: string;
  expiresAt: number;
  resendAt: number;
  attempts: number;
  used?: boolean;
  replaced?: boolean;
  maskedDestination: string;
};

type Grant = {
  uid: string;
  purpose: 'change-proof' | 'change' | 'reset';
  expiresAt: number;
  used?: boolean;
  deviceId?: string;
};

type MpinUnlockSession = {
  uid: string;
  deviceId: string;
  tokenHash?: string;
  expiresAt: number;
  lastActivityAt: number;
  revoked?: boolean;
};

export const MPIN_EMAIL_SENDER = Symbol('MPIN_EMAIL_SENDER');
export interface MpinEmailSender {
  sendCode(to: string, code: string, purpose: 'change' | 'recovery'): Promise<void>;
  sendEmailLink?(to: string, link: string, purpose: 'change' | 'recovery'): Promise<void>;
}

@Injectable()
export class MpinService {
  constructor(
    @Inject(FIREBASE_FIRESTORE) private readonly firestore: Firestore,
    @Inject(FIREBASE_AUTH) private readonly auth: Auth,
    @Inject(MPIN_EMAIL_SENDER) private readonly emailSender: MpinEmailSender,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async status(uid: string, context?: MpinStatusContextDto, deviceId?: string) {
    const account = await this.account(uid);
    const now = Date.now();
    const isLocked = (account.lockedUntil ?? 0) > now;
    const remainingAttempts = isLocked
      ? 0
      : account.lockedUntil && account.lockedUntil <= now
        ? MPIN_ATTEMPT_LIMIT
        : Math.max(0, MPIN_ATTEMPT_LIMIT - (account.failedAttempts ?? 0));

    let isUnlocked = !!account.pinHash && (account.unlockExpiresAt ?? 0) > now;
    if (isUnlocked && deviceId) {
      const unlockSnap = await this.firestore.collection(MPIN_UNLOCKS).doc(`${uid}_${deviceId}`).get();
      if (unlockSnap.exists) {
        const unlock = unlockSnap.data() as MpinUnlockSession;
        if (unlock.revoked || unlock.expiresAt <= now) {
          isUnlocked = false;
        } else if (context?.inactiveForMs && context.inactiveForMs >= MPIN_INACTIVITY_TIMEOUT_MS) {
          isUnlocked = false;
        }
      }
    } else if (isUnlocked && context?.inactiveForMs && context.inactiveForMs >= MPIN_INACTIVITY_TIMEOUT_MS) {
      isUnlocked = false;
    }

    return {
      configured: !!account.pinHash,
      requiresUnlock: !!account.pinHash && !isUnlocked,
      locked: isLocked,
      ...(isLocked && account.lockedUntil ? { lockedUntil: account.lockedUntil } : {}),
      remainingAttempts,
      ...(account.unlockExpiresAt && isUnlocked ? { unlockExpiresAt: account.unlockExpiresAt } : {}),
      serverTime: now,
      emergencyAccessAllowed: false,
      emergencyAlertIds: [],
    };
  }

  async create(uid: string, pin: string) {
    const ref = this.firestore.collection(MPIN_ACCOUNTS).doc(uid);
    const existing = await ref.get();
    if (existing.exists && (existing.data() as Account)?.pinHash) {
      throw new ConflictException('MPIN is already configured');
    }
    await ref.set(
      { pinHash: await this.hash(pin), failedAttempts: 0, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return { success: true as const };
  }

  async unlock(uid: string, pin: string, deviceId?: string) {
    const ref = this.firestore.collection(MPIN_ACCOUNTS).doc(uid);
    const snapshot = await ref.get();
    const account = (snapshot.data() ?? {}) as Account;
    const now = Date.now();
    if (!account.pinHash) throw new BadRequestException('MPIN is not configured');
    if ((account.lockedUntil ?? 0) > now) {
      throw new HttpException(
        { message: 'MPIN is locked', retryAt: account.lockedUntil },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const currentFailed =
      account.lockedUntil && account.lockedUntil <= now ? 0 : (account.failedAttempts ?? 0);
    if (!(await this.matches(pin, account.pinHash))) {
      const failedAttempts = currentFailed + 1;
      await ref.set(
        {
          failedAttempts,
          ...(failedAttempts >= MPIN_ATTEMPT_LIMIT && { lockedUntil: now + MPIN_LOCK_MS }),
        },
        { merge: true },
      );
      throw new UnauthorizedException('Incorrect MPIN');
    }

    const unlockExpiresAt = now + MPIN_UNLOCK_MS;
    await ref.set(
      {
        failedAttempts: 0,
        lockedUntil: FieldValue.delete(),
        unlockExpiresAt,
      },
      { merge: true },
    );

    if (deviceId) {
      const unlockToken = randomBytes(24).toString('base64url');
      await this.firestore
        .collection(MPIN_UNLOCKS)
        .doc(`${uid}_${deviceId}`)
        .set({
          uid,
          deviceId,
          tokenHash: this.digest(unlockToken),
          expiresAt: unlockExpiresAt,
          lastActivityAt: now,
          revoked: false,
        });

      return { success: true as const, unlockToken, expiresAt: unlockExpiresAt };
    }

    return { success: true as const };
  }

  async authorizeChange(uid: string, pin: string) {
    await this.verifyCurrent(uid, pin);
    return this.grant(uid, 'change-proof', MPIN_GRANT_MS);
  }

  async requestChangeCode(uid: string, proof: string) {
    await this.consumeGrant(uid, proof, 'change-proof', true);
    return this.issueChallenge(uid, 'change-code', 'change');
  }

  async resendChangeCode(uid: string, challengeId: string) {
    return this.resend(uid, challengeId, 'change-code', 'change');
  }

  async verifyChangeCode(uid: string, challengeId: string, code: string) {
    await this.verifyCode(uid, challengeId, code, 'change-code');
    return this.grant(uid, 'change', MPIN_GRANT_MS);
  }

  async change(uid: string, authorization: string, pin: string) {
    await this.consumeGrant(uid, authorization, 'change', true);
    await this.replacePin(uid, pin);
    return { success: true as const };
  }

  async requestRecovery(uid: string) {
    return this.issueChallenge(uid, 'recovery', 'recovery');
  }

  async resendRecovery(uid: string, challengeId: string) {
    return this.resend(uid, challengeId, 'recovery', 'recovery');
  }

  async verifyRecovery(uid: string, challengeId: string, code: string) {
    await this.verifyCode(uid, challengeId, code, 'recovery');
    return this.grant(uid, 'reset', MPIN_GRANT_MS);
  }

  async reset(uid: string, authorization: string, pin: string) {
    await this.consumeGrant(uid, authorization, 'reset', true);
    await this.replacePin(uid, pin);
    return { success: true as const };
  }

  async requestChangeEmailLink(uid: string, proof?: string, deviceId?: string) {
    if (proof) {
      await this.consumeGrant(uid, proof, 'change-proof', true);
    }
    return this.issueEmailLink(uid, 'change', deviceId);
  }

  async requestRecoveryEmailLink(uid: string, deviceId?: string) {
    return this.issueEmailLink(uid, 'recovery', deviceId);
  }

  async verifyEmailLinkAndChange(uid: string, token: string, pin: string) {
    try {
      await this.consumeGrant(uid, token, 'change', true);
    } catch {
      await this.consumeGrant(uid, token, 'reset', true);
    }
    await this.replacePin(uid, pin);
    return { success: true as const };
  }

  private async issueEmailLink(uid: string, purpose: 'change' | 'recovery', deviceId?: string) {
    const user = await this.auth.getUser(uid);
    if (!user.email || !user.emailVerified) {
      throw new ForbiddenException({
        code: 'EMAIL_UNVERIFIED',
        message: 'Registered email verification is required',
      });
    }
    const grantPurpose: Grant['purpose'] = purpose === 'change' ? 'change' : 'reset';
    const grant = await this.grant(uid, grantPurpose, MPIN_GRANT_MS, deviceId);
    const baseUrl =
      this.config?.get<string>('MPIN_DEEP_LINK_BASE_URL') ||
      process.env.MPIN_DEEP_LINK_BASE_URL ||
      MPIN_DEFAULT_DEEP_LINK_BASE_URL;
    const deepLink = `${baseUrl}?token=${encodeURIComponent(grant.token)}&purpose=${purpose}`;

    if (this.emailSender.sendEmailLink) {
      await this.emailSender.sendEmailLink(user.email, deepLink, purpose);
    } else {
      await this.emailSender.sendCode(user.email, deepLink, purpose);
    }

    return {
      maskedDestination: this.mask(user.email),
      expiresAt: grant.expiresAt,
      serverTime: Date.now(),
    };
  }

  private async verifyCurrent(uid: string, pin: string) {
    const ref = this.firestore.collection(MPIN_ACCOUNTS).doc(uid);
    const snapshot = await ref.get();
    const account = (snapshot.data() ?? {}) as Account;
    const now = Date.now();
    if (!account.pinHash) throw new BadRequestException('MPIN is not configured');
    if ((account.lockedUntil ?? 0) > now) {
      throw new HttpException(
        { message: 'MPIN is locked', retryAt: account.lockedUntil },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const currentFailed =
      account.lockedUntil && account.lockedUntil <= now ? 0 : (account.failedAttempts ?? 0);
    if (!(await this.matches(pin, account.pinHash))) {
      const failedAttempts = currentFailed + 1;
      await ref.set(
        {
          failedAttempts,
          ...(failedAttempts >= MPIN_ATTEMPT_LIMIT && { lockedUntil: now + MPIN_LOCK_MS }),
        },
        { merge: true },
      );
      throw new UnauthorizedException('Incorrect MPIN');
    }
    await ref.set(
      {
        failedAttempts: 0,
        lockedUntil: FieldValue.delete(),
      },
      { merge: true },
    );
  }

  private async replacePin(uid: string, pin: string) {
    const ref = this.firestore.collection(MPIN_ACCOUNTS).doc(uid);
    const now = Date.now();

    const runTx = typeof this.firestore.runTransaction === 'function'
      ? (cb: (tx: any) => Promise<any>) => this.firestore.runTransaction(cb)
      : async (cb: (tx: any) => Promise<any>) => {
          const fakeTx = {
            get: (r: any) => r.get(),
            set: (r: any, d: any, o: any) => r.set(d, o),
          };
          return cb(fakeTx);
        };

    await runTx(async (transaction: any) => {
      const snapshot = await transaction.get(ref);
      const account = (snapshot.data() ?? {}) as Account;

      if (account.changeLockUntil && account.changeLockUntil > now) {
        throw new ConflictException({
          code: 'CONCURRENT_CHANGE_IN_PROGRESS',
          message: 'An MPIN update is already in progress. Please wait.',
        });
      }

      if (account.pinHash && (await this.matches(pin, account.pinHash))) {
        throw new BadRequestException({
          code: 'PIN_REUSE_FORBIDDEN',
          message: 'New MPIN cannot be the same as your existing MPIN',
        });
      }

      if (account.pinHistory?.length) {
        for (const oldHash of account.pinHistory) {
          if (await this.matches(pin, oldHash)) {
            throw new BadRequestException({
              code: 'PIN_REUSE_FORBIDDEN',
              message: 'New MPIN cannot be one of your recently used MPINs',
            });
          }
        }
      }

      const newHash = await this.hash(pin);
      const pinHistory = [account.pinHash, ...(account.pinHistory ?? [])]
        .filter((h): h is string => Boolean(h))
        .slice(0, MPIN_HISTORY_LIMIT);

      transaction.set(
        ref,
        {
          pinHash: newHash,
          pinHistory,
          failedAttempts: 0,
          lockedUntil: FieldValue.delete(),
          unlockExpiresAt: FieldValue.delete(),
          changeLockUntil: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });

    await this.revokeAllUnlocks(uid);
  }

  private async issueChallenge(
    uid: string,
    purpose: 'change-code' | 'recovery',
    emailPurpose: 'change' | 'recovery',
  ) {
    const user = await this.auth.getUser(uid);
    if (!user.email || !user.emailVerified) {
      throw new ForbiddenException('Registered email verification is required');
    }
    const now = Date.now();
    const challengeId = randomBytes(18).toString('hex');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const challenge: Challenge = {
      uid,
      purpose,
      codeHash: this.digest(code),
      expiresAt: now + MPIN_CODE_MS,
      resendAt: now + MPIN_RESEND_MS,
      attempts: 0,
      maskedDestination: this.mask(user.email),
    };
    await this.emailSender.sendCode(user.email, code, emailPurpose);
    await this.firestore.collection(MPIN_CHALLENGES).doc(challengeId).set(challenge);
    return {
      challengeId,
      maskedDestination: challenge.maskedDestination,
      expiresAt: challenge.expiresAt,
      resendAt: challenge.resendAt,
      serverTime: now,
    };
  }

  private async resend(
    uid: string,
    challengeId: string,
    purpose: 'change-code' | 'recovery',
    emailPurpose: 'change' | 'recovery',
  ) {
    const ref = this.firestore.collection(MPIN_CHALLENGES).doc(challengeId);
    const snapshot = await ref.get();
    const old = snapshot.data() as Challenge | undefined;
    if (
      !snapshot.exists ||
      !old ||
      old.uid !== uid ||
      old.purpose !== purpose ||
      old.replaced ||
      old.used
    ) {
      throw new BadRequestException('Invalid challenge');
    }
    if ((old.resendAt ?? 0) > Date.now()) {
      throw new HttpException('Code cannot be resent yet', HttpStatus.TOO_MANY_REQUESTS);
    }
    await ref.set({ replaced: true }, { merge: true });
    return this.issueChallenge(uid, purpose, emailPurpose);
  }

  private async verifyCode(
    uid: string,
    challengeId: string,
    code: string,
    purpose: 'change-code' | 'recovery',
  ) {
    const ref = this.firestore.collection(MPIN_CHALLENGES).doc(challengeId);
    const snapshot = await ref.get();
    const challenge = snapshot.data() as Challenge | undefined;
    const now = Date.now();
    if (
      !snapshot.exists ||
      !challenge ||
      challenge.uid !== uid ||
      challenge.purpose !== purpose ||
      challenge.replaced ||
      challenge.used ||
      challenge.expiresAt <= now
    ) {
      throw new UnauthorizedException('Invalid or expired code');
    }
    if (challenge.attempts >= MPIN_CODE_ATTEMPT_LIMIT) {
      throw new HttpException('Too many code attempts', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (challenge.codeHash !== this.digest(code)) {
      await ref.set({ attempts: challenge.attempts + 1 }, { merge: true });
      throw new UnauthorizedException('Invalid or expired code');
    }
    await ref.set({ used: true }, { merge: true });
  }

  private async grant(
    uid: string,
    purpose: Grant['purpose'],
    lifetime: number,
    deviceId?: string,
  ) {
    const token = randomBytes(32).toString('base64url');
    await this.firestore
      .collection(MPIN_GRANTS)
      .doc(this.digest(token))
      .set({
        uid,
        purpose,
        expiresAt: Date.now() + lifetime,
        used: false,
        ...(deviceId ? { deviceId } : {}),
      } satisfies Grant);
    return { token, expiresAt: Date.now() + lifetime, serverTime: Date.now() };
  }

  private async consumeGrant(
    uid: string,
    token: string,
    purpose: Grant['purpose'],
    consume: boolean,
  ) {
    const ref = this.firestore.collection(MPIN_GRANTS).doc(this.digest(token));
    const runTx = typeof this.firestore.runTransaction === 'function'
      ? (cb: (tx: any) => Promise<any>) => this.firestore.runTransaction(cb)
      : async (cb: (tx: any) => Promise<any>) => {
          const fakeTx = {
            get: (r: any) => r.get(),
            set: (r: any, d: any, o: any) => r.set(d, o),
          };
          return cb(fakeTx);
        };

    await runTx(async (transaction: any) => {
      const snapshot = await transaction.get(ref);
      const grant = snapshot.data() as Grant | undefined;
      if (
        !snapshot.exists ||
        !grant ||
        grant.uid !== uid ||
        grant.purpose !== purpose ||
        grant.used ||
        grant.expiresAt <= Date.now()
      ) {
        throw new UnauthorizedException({
          code: 'INVALID_GRANT',
          message: 'Invalid or expired authorization',
        });
      }
      if (consume) {
        transaction.set(ref, { used: true }, { merge: true });
      }
    });
  }

  async revokeAllUnlocks(uid: string) {
    await this.firestore
      .collection(MPIN_ACCOUNTS)
      .doc(uid)
      .set({ unlockExpiresAt: FieldValue.delete() }, { merge: true });

    if (this.firestore.collection(MPIN_UNLOCKS)?.where) {
      const snaps = await this.firestore.collection(MPIN_UNLOCKS).where('uid', '==', uid).get();
      if (snaps && snaps.forEach) {
        snaps.forEach((doc) => {
          doc.ref.set({ revoked: true, expiresAt: 0 }, { merge: true });
        });
      }
    }
  }

  async revokeDeviceUnlock(uid: string, deviceId?: string) {
    const target = deviceId || 'default';
    await this.firestore
      .collection(MPIN_UNLOCKS)
      .doc(`${uid}_${target}`)
      .set({ revoked: true, expiresAt: 0 }, { merge: true });
  }

  async isUnlocked(uid: string, deviceId?: string, unlockToken?: string): Promise<boolean> {
    const account = await this.account(uid);
    if (!account.pinHash) {
      return true;
    }
    const now = Date.now();
    const target = deviceId || 'default';
    const unlockDoc = await this.firestore.collection(MPIN_UNLOCKS).doc(`${uid}_${target}`).get();
    if (!unlockDoc.exists) {
      return !!account.unlockExpiresAt && account.unlockExpiresAt > now;
    }
    const unlock = unlockDoc.data() as MpinUnlockSession;
    if (unlock.revoked || unlock.expiresAt <= now) {
      return false;
    }
    if (unlockToken && unlock.tokenHash && unlock.tokenHash !== this.digest(unlockToken)) {
      return false;
    }
    if (now - (unlock.lastActivityAt ?? now) > MPIN_INACTIVITY_TIMEOUT_MS) {
      await unlockDoc.ref.set({ revoked: true }, { merge: true });
      return false;
    }
    await unlockDoc.ref.set({ lastActivityAt: now }, { merge: true });
    return true;
  }

  private account(uid: string) {
    return this.firestore
      .collection(MPIN_ACCOUNTS)
      .doc(uid)
      .get()
      .then((s) => (s.data() ?? {}) as Account);
  }

  private async hash(value: string) {
    const salt = randomBytes(16);
    const derived = (await scrypt(value, salt, 64)) as Buffer;
    return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
  }

  private async matches(value: string, encoded: string) {
    const [, salt, expected] = encoded.split('$');
    if (!salt || !expected) return false;
    const actual = (await scrypt(value, Buffer.from(salt, 'base64'), 64)) as Buffer;
    const target = Buffer.from(expected, 'base64');
    return actual.length === target.length && timingSafeEqual(actual, target);
  }

  private digest(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private mask(email: string) {
    const [name, domain] = email.split('@');
    return `${name.slice(0, 1)}***@${domain}`;
  }
}