import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Auth, DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { FIREBASE_AUTH } from '@/infra/firebase/firebase.constants';
import { FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import type { EnvironmentVariables } from '@/config/env.validation';
import { ABLY_REST } from '@/infra/ably/ably.constants';
import type { Rest, TokenRequest } from 'ably';
import { REALTIME_CHANNELS } from '@/modules/realtime/realtime.constants';
import { ONE_HOUR_IN_MILLISECONDS } from '@/common/constants/time.constants';
import { MailService } from '@/infra/mail/mail.service';
import { normalizeEmail, normalizeUsername } from './auth.validation';
import { createHash, randomBytes, randomInt, verify } from 'node:crypto';
import type {
  ChangePasswordDto,
  EnrollPhoneKeyDto,
  ForgotPasswordDto,
  LoginDto,
  PhoneAuthChallengeDto,
  RegisterDto,
  ResendVerificationCodeDto,
  RevokePhoneKeyDto,
  UpdateOnboardingDto,
  VerifyEmailCodeDto,
  VerifyPhoneSignatureDto,
} from './auth.dto';
import { MPIN_ACCOUNTS } from '@/modules/mpin/mpin.constants';
import {
  EMAIL_VERIFICATION_CODES_COLLECTION,
  REGISTRATION_PENDING_COLLECTION,
  REGISTRATION_PENDING_TTL_MS,
} from './registration.constants';

const USERNAMES_COLLECTION = 'usernames';
const PROFILES_COLLECTION = 'profiles';
const GENERIC_LOGIN_ERROR = 'Invalid username/email or password.';
const RESET_MESSAGE = 'If an account exists, a password reset email has been sent.';
const RESET_EMAIL_WINDOW_MS = 60_000;
const RESET_EMAIL_LIMIT = 3;
const REGISTRATION_EMAIL_WINDOW_MS = 60_000;
const REGISTRATION_EMAIL_LIMIT = 5;

type PendingRegistration = {
  uid: string;
  username: string;
  email: string;
  expiresAt: { toDate(): Date };
};

type EmailVerificationCodeDoc = {
  codeHash: string;
  expiresAt: Date | { toDate(): Date };
  attempts: number;
  createdAt: Date | { toDate(): Date };
  lastSentAt?: Date | { toDate(): Date } | null;
  consumedAt?: Date | { toDate(): Date } | null;
};

@Injectable()
export class AuthService {
  constructor(
    @Inject(FIREBASE_AUTH) private readonly auth: Auth,
    @Inject(ABLY_REST) private readonly ably: Rest,
    @Inject(FIREBASE_FIRESTORE) private readonly firestore: Firestore,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly mail: MailService,
  ) {}

  private readonly resetAttempts = new Map<string, number[]>();
  private readonly registrationAttempts = new Map<string, number[]>();

  async register(input: RegisterDto): Promise<{ email: string }> {
    const username = normalizeUsername(input.username);
    const email = normalizeEmail(input.email);
    this.checkEmailRate(this.registrationAttempts, email, REGISTRATION_EMAIL_LIMIT);
    const existingUser = await this.findFirebaseUserByEmail(email);
    const pendingRef = this.firestore.collection(REGISTRATION_PENDING_COLLECTION).doc(email);
    const usernameRef = this.firestore.collection(USERNAMES_COLLECTION).doc(username);
    if (existingUser?.emailVerified) {
      throw new ConflictException('An account with this email already exists.');
    }
    if (existingUser) {
      throw new ConflictException('An account with this email already exists.');
    }
    const now = new Date();
    let uid: string | undefined;
    try {
      await this.firestore.runTransaction(async (transaction) => {
        const existing = await transaction.get(usernameRef);
        const pending = await transaction.get(pendingRef);
        if (existing.exists) {
          const existingData = existing.data() as { uid?: string; email?: string } | undefined;
          if (existingData?.uid || existingData?.email !== email) {
            throw new ConflictException('Username is already taken.');
          }
        }
        if (pending.exists) {
          throw new ConflictException('A registration is already pending for this email.');
        }
        transaction.set(
          usernameRef,
          { username, email, createdAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
      });

      const user = await this.auth.createUser({ email, password: input.password });
      uid = user.uid;
      await pendingRef.set({
        uid,
        username,
        email,
        expiresAt: new Date(now.getTime() + REGISTRATION_PENDING_TTL_MS),
      });
    } catch (error) {
      await pendingRef.delete().catch(() => undefined);
      await usernameRef.delete().catch(() => undefined);
      if (uid) await this.auth.deleteUser(uid).catch(() => undefined);
      throw error;
    }

    // Account is committed; send failure leaves the pending user so resend can retry.
    await this.issueAndSendVerificationCode(uid, email);
    return { email };
  }

  /**
   * Public verify: register does not return an idToken, so the 6-digit code
   * (plus email) is the auth factor. On success sets Firebase emailVerified
   * and finalizes the RideGuard profile.
   */
  async verifyEmailCode(input: VerifyEmailCodeDto): Promise<{ uid: string; email: string }> {
    const email = normalizeEmail(input.email);
    const user = await this.findFirebaseUserByEmail(email);
    if (!user) {
      throw new BadRequestException('Invalid verification code.');
    }
    if (user.emailVerified) {
      throw new ConflictException('Email is already verified.');
    }

    const codeRef = this.firestore.collection(EMAIL_VERIFICATION_CODES_COLLECTION).doc(user.uid);
    const snapshot = await codeRef.get();
    const stored = snapshot.exists ? (snapshot.data() as EmailVerificationCodeDoc) : undefined;
    if (!stored || stored.consumedAt) {
      throw new BadRequestException('Invalid verification code.');
    }

    const now = new Date();
    const expiresAt = this.toDate(stored.expiresAt);
    if (!expiresAt || expiresAt <= now) {
      await codeRef.delete().catch(() => undefined);
      throw new BadRequestException('Verification code has expired.');
    }

    const maxAttempts = this.config.get('VERIFICATION_CODE_MAX_ATTEMPTS', { infer: true });
    if (stored.attempts >= maxAttempts) {
      await codeRef.delete().catch(() => undefined);
      throw new HttpException(
        'Too many verification attempts. Request a new code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const expectedHash = this.hashVerificationCode(input.code, user.uid);
    if (stored.codeHash !== expectedHash) {
      const nextAttempts = stored.attempts + 1;
      if (nextAttempts >= maxAttempts) {
        await codeRef.delete().catch(() => undefined);
        throw new HttpException(
          'Too many verification attempts. Request a new code.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      await codeRef.set({ attempts: nextAttempts }, { merge: true });
      throw new BadRequestException('Invalid verification code.');
    }

    await this.auth.updateUser(user.uid, { emailVerified: true });
    const finalized = await this.finalizePendingRegistration(user.uid, email);
    await codeRef.set({ consumedAt: now }, { merge: true });
    await codeRef.delete().catch(() => undefined);
    return finalized;
  }

  async resendVerificationCode(input: ResendVerificationCodeDto): Promise<{ email: string }> {
    const email = normalizeEmail(input.email);
    const user = await this.findFirebaseUserByEmail(email);
    if (!user) {
      // Same generic shape as a successful resend to avoid account enumeration.
      return { email };
    }
    if (user.emailVerified) {
      throw new ConflictException('Email is already verified.');
    }

    const codeRef = this.firestore.collection(EMAIL_VERIFICATION_CODES_COLLECTION).doc(user.uid);
    const snapshot = await codeRef.get();
    const existing = snapshot.exists ? (snapshot.data() as EmailVerificationCodeDoc) : undefined;
    const cooldownSeconds = this.config.get('VERIFICATION_RESEND_COOLDOWN_SECONDS', { infer: true });
    const lastSentAt = this.toDate(existing?.lastSentAt);
    if (lastSentAt) {
      const earliestResend = lastSentAt.getTime() + cooldownSeconds * 1000;
      if (Date.now() < earliestResend) {
        throw new HttpException(
          'Verification code was recently sent. Try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    if (snapshot.exists) {
      await codeRef.delete().catch(() => undefined);
    }
    await this.issueAndSendVerificationCode(user.uid, email);
    return { email };
  }

  async login(input: LoginDto): Promise<{ uid: string; email: string }> {
    const identifier = input.identifier.trim().toLowerCase();
    const email = identifier.includes('@') ? identifier : await this.resolveUsername(identifier);
    if (!email) throw new UnauthorizedException(GENERIC_LOGIN_ERROR);

    const response = await fetch(
      `${this.config.get('FIREBASE_AUTH_API_BASE_URL', { infer: true })}/accounts:signInWithPassword?key=${encodeURIComponent(
        this.config.get('FIREBASE_WEB_API_KEY', { infer: true }),
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: input.password, returnSecureToken: true }),
      },
    );
    const body = (await response.json().catch(() => null)) as {
      localId?: string;
      email?: string;
    } | null;
    if (!response.ok || !body?.localId || !body.email) {
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }
    const user = await this.auth.getUser(body.localId);
    if (!user.emailVerified) {
      throw new HttpException(
        {
          code: 'ACCOUNT_UNVERIFIED',
          message: 'Account email is not verified.',
          email: body.email,
          uid: body.localId,
          emailVerified: false,
        },
        HttpStatus.FORBIDDEN,
      );
    }
    return { uid: body.localId, email: body.email };
  }

  async forgotPassword(input: ForgotPasswordDto): Promise<{ message: string }> {
    const email = normalizeEmail(input.email);
    const now = Date.now();
    const attempts = (this.resetAttempts.get(email) ?? []).filter(
      (timestamp) => now - timestamp < RESET_EMAIL_WINDOW_MS,
    );
    if (attempts.length >= RESET_EMAIL_LIMIT) {
      throw new HttpException(
        'Too many password reset requests. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    attempts.push(now);
    this.resetAttempts.set(email, attempts);
    const response = await fetch(
      `${this.config.get('FIREBASE_AUTH_API_BASE_URL', { infer: true })}/accounts:sendOobCode?key=${encodeURIComponent(
        this.config.get('FIREBASE_WEB_API_KEY', { infer: true }),
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
      },
    );
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    if (!response.ok && body?.error?.message !== 'EMAIL_NOT_FOUND') {
      throw new Error('Password reset service unavailable');
    }
    return { message: RESET_MESSAGE };
  }

  /**
   * Authenticated password change: verify current password via Identity Toolkit
   * signInWithPassword (never trust the client), then Admin SDK updateUser +
   * revokeRefreshTokens. Does not log passwords or the sign-in idToken.
   */
  async changePassword(
    uid: string,
    input: ChangePasswordDto,
  ): Promise<{ success: true }> {
    if (input.newPassword === input.currentPassword) {
      throw new BadRequestException('New password must be different from the current password.');
    }

    const user = await this.auth.getUser(uid);
    const email = user.email;
    if (!email) {
      throw new BadRequestException('User does not have an associated email address.');
    }

    const response = await fetch(
      `${this.config.get('FIREBASE_AUTH_API_BASE_URL', { infer: true })}/accounts:signInWithPassword?key=${encodeURIComponent(
        this.config.get('FIREBASE_WEB_API_KEY', { infer: true }),
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: input.currentPassword,
          returnSecureToken: true,
        }),
      },
    );
    const body = (await response.json().catch(() => null)) as {
      localId?: string;
    } | null;

    if (!response.ok || !body?.localId || body.localId !== uid) {
      throw new UnauthorizedException('Invalid password.');
    }

    await this.auth.updateUser(uid, { password: input.newPassword });
    await this.auth.revokeRefreshTokens(uid);

    return { success: true };
  }

  // *** VERIFY FIREBASE ID TOKEN ***
  verifyToken(token: string, checkRevoked = false): Promise<DecodedIdToken> {
    return this.auth.verifyIdToken(token, checkRevoked);
  }

  private async resolveUsername(username: string): Promise<string | null> {
    const snapshot = await this.firestore
      .collection(USERNAMES_COLLECTION)
      .doc(normalizeUsername(username))
      .get();
    const email = (snapshot.data() as { email?: unknown } | undefined)?.email;
    return typeof email === 'string' ? email : null;
  }

  private async findFirebaseUserByEmail(email: string) {
    try {
      return await this.auth.getUserByEmail(email);
    } catch (error) {
      if ((error as { code?: string }).code === 'auth/user-not-found') return null;
      throw error;
    }
  }

  private checkEmailRate(store: Map<string, number[]>, email: string, limit: number) {
    const now = Date.now();
    const attempts = (store.get(email) ?? []).filter(
      (timestamp) => now - timestamp < REGISTRATION_EMAIL_WINDOW_MS,
    );
    if (attempts.length >= limit) {
      throw new HttpException('Too many requests. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    attempts.push(now);
    store.set(email, attempts);
  }

  private hashVerificationCode(code: string, uid: string): string {
    const pepper = this.config.get('VERIFICATION_CODE_PEPPER', { infer: true });
    return createHash('sha256').update(`${code}${uid}${pepper}`, 'utf8').digest('hex');
  }

  private async issueAndSendVerificationCode(uid: string, email: string): Promise<void> {
    const ttlMinutes = this.config.get('VERIFICATION_CODE_TTL_MINUTES', { infer: true });
    const now = new Date();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeRef = this.firestore.collection(EMAIL_VERIFICATION_CODES_COLLECTION).doc(uid);

    await codeRef.set({
      codeHash: this.hashVerificationCode(code, uid),
      expiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
      attempts: 0,
      createdAt: now,
      lastSentAt: null,
      consumedAt: null,
    });

    await this.mail.sendVerificationCode(email, code);
    await codeRef.set({ lastSentAt: new Date() }, { merge: true });
  }

  private async finalizePendingRegistration(
    uid: string,
    email: string,
  ): Promise<{ uid: string; email: string }> {
    const pendingRef = this.firestore.collection(REGISTRATION_PENDING_COLLECTION).doc(email);
    const snapshot = await pendingRef.get();
    const pending = snapshot.exists ? (snapshot.data() as PendingRegistration) : undefined;
    if (!pending || pending.uid !== uid || pending.expiresAt.toDate() <= new Date()) {
      if (snapshot.exists) await pendingRef.delete();
      throw new BadRequestException('Registration is no longer pending.');
    }
    const profileRef = this.firestore.collection(PROFILES_COLLECTION).doc(uid);
    const profile = await profileRef.get();
    if (!profile.exists) {
      await profileRef.create({
        uid,
        username: pending.username,
        email: pending.email,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await this.firestore
      .collection(USERNAMES_COLLECTION)
      .doc(pending.username)
      .set({ uid, email: pending.email }, { merge: true });
    await pendingRef.delete();
    return { uid, email: pending.email };
  }

  // *** ACCOUNT DELETION ***
  async isDeletionScheduled(uid: string): Promise<boolean> {
    const profile = await this.firestore.collection(PROFILES_COLLECTION).doc(uid).get();
    if (!profile.exists) return false;
    const deletionScheduledAt = (profile.data() as { deletionScheduledAt?: unknown } | undefined)
      ?.deletionScheduledAt;
    if (!deletionScheduledAt) return false;
    const scheduledDate = this.toDate(deletionScheduledAt);
    return scheduledDate !== null;
  }

  async getDeletionStatus(
    uid: string,
  ): Promise<{ scheduled: boolean; deletionScheduledAt: string | null }> {
    const profile = await this.firestore.collection(PROFILES_COLLECTION).doc(uid).get();
    if (!profile.exists) {
      return { scheduled: false, deletionScheduledAt: null };
    }
    const deletionScheduledAt = (profile.data() as { deletionScheduledAt?: unknown } | undefined)
      ?.deletionScheduledAt;
    const scheduledDate = this.toDate(deletionScheduledAt);
    if (!scheduledDate) {
      return { scheduled: false, deletionScheduledAt: null };
    }
    return { scheduled: true, deletionScheduledAt: scheduledDate.toISOString() };
  }

  async requestAccountDeletion(
    uid: string,
    password: string,
  ): Promise<{ scheduled: boolean; deletionScheduledAt: string }> {
    const user = await this.auth.getUser(uid);
    const email = user.email;
    if (!email) {
      throw new BadRequestException('User does not have an associated email address.');
    }

    const response = await fetch(
      `${this.config.get('FIREBASE_AUTH_API_BASE_URL', { infer: true })}/accounts:signInWithPassword?key=${encodeURIComponent(
        this.config.get('FIREBASE_WEB_API_KEY', { infer: true }),
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      },
    );
    const body = (await response.json().catch(() => null)) as {
      localId?: string;
      email?: string;
    } | null;

    if (!response.ok || !body?.localId || body.localId !== uid) {
      throw new UnauthorizedException('Invalid password.');
    }

    const graceDays = this.config.get('ACCOUNT_DELETION_GRACE_DAYS', { infer: true }) ?? 30;
    const deletionScheduledAt = new Date(Date.now() + graceDays * 24 * 60 * 60 * 1000);

    const profileRef = this.firestore.collection(PROFILES_COLLECTION).doc(uid);
    await profileRef.set(
      {
        deletionScheduledAt,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await this.auth.revokeRefreshTokens(uid).catch(() => undefined);
    await this.auth.updateUser(uid, { disabled: true }).catch(() => undefined);

    return { scheduled: true, deletionScheduledAt: deletionScheduledAt.toISOString() };
  }

  async cancelAccountDeletion(uid: string): Promise<{ scheduled: boolean }> {
    const profileRef = this.firestore.collection(PROFILES_COLLECTION).doc(uid);
    await profileRef.set(
      {
        deletionScheduledAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await this.auth.updateUser(uid, { disabled: false }).catch(() => undefined);
    return { scheduled: false };
  }

  private toDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof (value as { toDate?: unknown }).toDate === 'function') {
      return (value as { toDate: () => Date }).toDate();
    }
    const parsed = new Date(value as string | number);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // *** CREATE ABLY TOKEN REQUEST FOR USER ***
  // *** ONBOARDING PROGRESS ***
  async getOnboarding(uid: string) {
    const snap = await this.firestore.collection('onboarding').doc(uid).get();
    const mpinAccount = await this.firestore.collection(MPIN_ACCOUNTS).doc(uid).get();
    const mpinConfigured = !!(mpinAccount.data() as { pinHash?: string } | undefined)?.pinHash;

    if (!snap.exists) {
      return {
        uid,
        step: 'profile',
        completedSteps: [],
        completed: false,
        mpinConfigured,
      };
    }
    const data = (snap.data() ?? {}) as Record<string, any>;
    return {
      uid,
      step: data.step ?? 'profile',
      completedSteps: data.completedSteps ?? [],
      completed: !!data.completed,
      mpinConfigured,
      ...(data.data ? { data: data.data } : {}),
    };
  }

  async updateOnboarding(uid: string, input: UpdateOnboardingDto) {
    const ref = this.firestore.collection('onboarding').doc(uid);
    await ref.set(
      {
        uid,
        ...(input.step ? { step: input.step } : {}),
        ...(input.completedSteps ? { completedSteps: input.completedSteps } : {}),
        ...(input.data ? { data: input.data } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return this.getOnboarding(uid);
  }

  async completeOnboarding(uid: string) {
    const mpinAccount = await this.firestore.collection(MPIN_ACCOUNTS).doc(uid).get();
    const hasPin = !!(mpinAccount.data() as { pinHash?: string } | undefined)?.pinHash;
    if (!hasPin) {
      throw new BadRequestException({
        code: 'MPIN_REQUIRED',
        message: 'MPIN setup is required before completing onboarding',
      });
    }

    const ref = this.firestore.collection('onboarding').doc(uid);
    await ref.set(
      {
        uid,
        completed: true,
        completedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { success: true, completed: true };
  }

  // *** PHONE AUTHENTICATION ***
  async enrollPhoneKey(uid: string, input: EnrollPhoneKeyDto) {
    const docId = `${uid}_${input.deviceId}`;
    await this.firestore.collection('phoneAuthKeys').doc(docId).set({
      uid,
      deviceId: input.deviceId,
      publicKey: input.publicKey,
      algorithm: input.algorithm || 'ed25519',
      createdAt: Date.now(),
      revoked: false,
    });
    return { success: true, deviceId: input.deviceId };
  }

  async issuePhoneChallenge(input: PhoneAuthChallengeDto) {
    const challengeId = randomBytes(16).toString('hex');
    const nonce = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + 5 * 60 * 1000;

    await this.firestore.collection('phoneAuthChallenges').doc(challengeId).set({
      challengeId,
      deviceId: input.deviceId,
      nonce,
      expiresAt,
      used: false,
    });

    return { challengeId, nonce, expiresAt };
  }

  async verifyPhoneSignature(input: VerifyPhoneSignatureDto) {
    const challengeRef = this.firestore.collection('phoneAuthChallenges').doc(input.challengeId);
    const snap = await challengeRef.get();
    const challenge = snap.data() as
      | { deviceId?: string; nonce?: string; expiresAt?: number; used?: boolean }
      | undefined;
    const now = Date.now();

    if (!snap.exists || !challenge || challenge.used || (challenge.expiresAt ?? 0) <= now) {
      throw new UnauthorizedException({
        code: 'INVALID_CHALLENGE',
        message: 'Invalid or expired phone authentication challenge',
      });
    }
    if (challenge.deviceId !== input.deviceId) {
      throw new UnauthorizedException({
        code: 'DEVICE_MISMATCH',
        message: 'Challenge device does not match',
      });
    }

    const keysQuery = await this.firestore
      .collection('phoneAuthKeys')
      .where('deviceId', '==', input.deviceId)
      .where('revoked', '==', false)
      .limit(1)
      .get();

    if (keysQuery.empty) {
      throw new UnauthorizedException({
        code: 'KEY_NOT_FOUND',
        message: 'No enrolled device key found or key is revoked',
      });
    }

    const keyDoc = keysQuery.docs[0].data() as {
      publicKey: string;
      algorithm?: string;
      uid: string;
    };

    let isValid = false;
    try {
      isValid = verify(
        null,
        Buffer.from(challenge.nonce!),
        keyDoc.publicKey,
        Buffer.from(input.signature, 'base64'),
      );
    } catch {
      isValid = false;
    }

    if (!isValid) {
      throw new UnauthorizedException({
        code: 'INVALID_SIGNATURE',
        message: 'Cryptographic phone signature verification failed',
      });
    }

    await challengeRef.set({ used: true }, { merge: true });
    return { verified: true, deviceId: input.deviceId, uid: keyDoc.uid, timestamp: now };
  }

  async revokePhoneKey(uid: string, input: RevokePhoneKeyDto) {
    const docId = `${uid}_${input.deviceId}`;
    await this.firestore.collection('phoneAuthKeys').doc(docId).set(
      { revoked: true, revokedAt: Date.now() },
      { merge: true },
    );
    return { success: true, revoked: true };
  }

  // *** LOGOUT & AUTHORIZATION REVOCATION ***
  async logout(uid: string, deviceId?: string) {
    if (deviceId) {
      await this.firestore
        .collection('mpinUnlocks')
        .doc(`${uid}_${deviceId}`)
        .set({ revoked: true, expiresAt: 0 }, { merge: true });
    } else {
      await this.firestore
        .collection(MPIN_ACCOUNTS)
        .doc(uid)
        .set({ unlockExpiresAt: FieldValue.delete() }, { merge: true });
    }
    return { success: true };
  }

  createAblyTokenRequest(userId: string): Promise<TokenRequest> {
    const userChannelPattern = REALTIME_CHANNELS.alertsForUser(userId);

    return this.ably.auth.createTokenRequest({
      clientId: userId,
      ttl: ONE_HOUR_IN_MILLISECONDS,
      capability: JSON.stringify({
        [userChannelPattern]: ['subscribe'],
        [REALTIME_CHANNELS.buttonEvents]: ['subscribe'],
      }),
    });
  }
}
