import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
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
  MPIN_LOCK_MS,
  MPIN_RESEND_MS,
  MPIN_UNLOCK_MS,
} from './mpin.constants';
import type { MpinStatusContextDto } from './mpin.dto';

const scrypt = promisify(scryptCallback);

type Purpose = 'change-proof' | 'change-code' | 'recovery';

type Account = {
  pinHash?: string;
  failedAttempts?: number;
  lockedUntil?: number;
  unlockExpiresAt?: number;
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
};

export const MPIN_EMAIL_SENDER = Symbol('MPIN_EMAIL_SENDER');
export interface MpinEmailSender {
  sendCode(to: string, code: string, purpose: 'change' | 'recovery'): Promise<void>;
}

@Injectable()
export class MpinService {
  constructor(
    @Inject(FIREBASE_FIRESTORE) private readonly firestore: Firestore,
    @Inject(FIREBASE_AUTH) private readonly auth: Auth,
    @Inject(MPIN_EMAIL_SENDER) private readonly emailSender: MpinEmailSender,
  ) {}

  async status(uid: string, _context?: MpinStatusContextDto) {
    const account = await this.account(uid);
    const now = Date.now();
    const isLocked = (account.lockedUntil ?? 0) > now;
    const remainingAttempts = isLocked
      ? 0
      : account.lockedUntil && account.lockedUntil <= now
        ? MPIN_ATTEMPT_LIMIT
        : Math.max(0, MPIN_ATTEMPT_LIMIT - (account.failedAttempts ?? 0));

    return {
      configured: !!account.pinHash,
      requiresUnlock:
        !!account.pinHash && (!account.unlockExpiresAt || account.unlockExpiresAt <= now),
      locked: isLocked,
      ...(isLocked && account.lockedUntil ? { lockedUntil: account.lockedUntil } : {}),
      remainingAttempts,
      ...(account.unlockExpiresAt ? { unlockExpiresAt: account.unlockExpiresAt } : {}),
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

  async unlock(uid: string, pin: string) {
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
        unlockExpiresAt: now + MPIN_UNLOCK_MS,
      },
      { merge: true },
    );
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
    await this.firestore
      .collection(MPIN_ACCOUNTS)
      .doc(uid)
      .set(
        {
          pinHash: await this.hash(pin),
          failedAttempts: 0,
          lockedUntil: FieldValue.delete(),
          unlockExpiresAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
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

  private async grant(uid: string, purpose: Grant['purpose'], lifetime: number) {
    const token = randomBytes(32).toString('base64url');
    await this.firestore
      .collection(MPIN_GRANTS)
      .doc(this.digest(token))
      .set({
        uid,
        purpose,
        expiresAt: Date.now() + lifetime,
        used: false,
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
    const snapshot = await ref.get();
    const grant = snapshot.data() as Grant | undefined;
    if (
      !snapshot.exists ||
      !grant ||
      grant.uid !== uid ||
      grant.purpose !== purpose ||
      grant.used ||
      grant.expiresAt <= Date.now()
    ) {
      throw new UnauthorizedException('Invalid or expired authorization');
    }
    if (consume) {
      await ref.set({ used: true }, { merge: true });
    }
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

export class MissingMpinEmailSender implements MpinEmailSender {
  sendCode(): Promise<void> {
    return Promise.reject(new ServiceUnavailableException('MPIN email delivery is not configured'));
  }
}
