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
import { normalizeEmail, normalizeUsername } from './auth.validation';
import type { ForgotPasswordDto, LoginDto, RegisterDto } from './auth.dto';
import {
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
@Injectable()
export class AuthService {
  constructor(
    @Inject(FIREBASE_AUTH) private readonly auth: Auth,
    @Inject(ABLY_REST) private readonly ably: Rest,
    @Inject(FIREBASE_FIRESTORE) private readonly firestore: Firestore,
    private readonly config: ConfigService<EnvironmentVariables, true>,
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
    return { email };
  }

  async verifyRegistration(authorization?: string): Promise<{ uid: string; email: string }> {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = await this.verifyToken(authorization.slice(7));
    const user = await this.auth.getUser(token.uid);
    const email = normalizeEmail(user.email ?? '');
    if (!user.emailVerified || !email) {
      throw new BadRequestException('Email verification has not been completed.');
    }
    const pendingRef = this.firestore.collection(REGISTRATION_PENDING_COLLECTION).doc(email);
    const snapshot = await pendingRef.get();
    const pending = snapshot.exists ? (snapshot.data() as PendingRegistration) : undefined;
    if (!pending || pending.uid !== token.uid || pending.expiresAt.toDate() <= new Date()) {
      if (snapshot.exists) await pendingRef.delete();
      throw new BadRequestException('Registration is no longer pending.');
    }
    const profileRef = this.firestore.collection(PROFILES_COLLECTION).doc(token.uid);
    const profile = await profileRef.get();
    if (!profile.exists) {
      await profileRef.create({
        uid: token.uid,
        username: pending.username,
        email: pending.email,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await this.firestore
      .collection(USERNAMES_COLLECTION)
      .doc(pending.username)
      .set({ uid: token.uid, email: pending.email }, { merge: true });
    await pendingRef.delete();
    return { uid: token.uid, email: pending.email };
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
    if (!user.emailVerified) throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
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

  // *** CREATE ABLY TOKEN REQUEST FOR USER ***
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
