import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import type { Rest } from 'ably';
import { createHash } from 'node:crypto';

import { AuthService } from './auth.service';
import {
  EMAIL_VERIFICATION_CODES_COLLECTION,
  REGISTRATION_PENDING_COLLECTION,
} from './registration.constants';
import type { MailService } from '@/infra/mail/mail.service';

describe('AuthService email verification codes', () => {
  const PEPPER = 'test-verification-pepper';

  function makeConfig(custom: Record<string, unknown> = {}) {
    const values: Record<string, unknown> = {
      FIREBASE_AUTH_API_BASE_URL: 'https://identitytoolkit.googleapis.com/v1',
      FIREBASE_WEB_API_KEY: 'web-key',
      VERIFICATION_CODE_PEPPER: PEPPER,
      VERIFICATION_CODE_TTL_MINUTES: 10,
      VERIFICATION_CODE_MAX_ATTEMPTS: 5,
      VERIFICATION_RESEND_COOLDOWN_SECONDS: 60,
      ...custom,
    };
    return {
      get: jest.fn((key: string) => values[key]),
    } as never;
  }

  function makeMail(): MailService {
    return {
      sendVerificationCode: jest.fn().mockResolvedValue(undefined),
    } as unknown as MailService;
  }

  function hash(code: string, uid: string): string {
    return createHash('sha256').update(`${code}${uid}${PEPPER}`, 'utf8').digest('hex');
  }

  function makeService(opts: {
    auth?: Partial<Auth>;
    firestore?: Firestore;
    mail?: MailService;
    config?: ReturnType<typeof makeConfig>;
  }) {
    return new AuthService(
      (opts.auth ?? {}) as Auth,
      {} as Rest,
      opts.firestore ?? ({} as Firestore),
      opts.config ?? makeConfig(),
      opts.mail ?? makeMail(),
    );
  }

  it('register creates an unverified user and auto-sends a verification code', async () => {
    const pendingRef = { set: jest.fn(), delete: jest.fn() };
    const usernameRef = { delete: jest.fn() };
    const codeSet = jest.fn().mockResolvedValue(undefined);
    const codeRef = { set: codeSet, delete: jest.fn() };
    const transaction = {
      get: jest.fn().mockResolvedValue({ exists: false }),
      set: jest.fn(),
    };
    const firestore = {
      collection: jest.fn((name: string) => ({
        doc: jest.fn(() => {
          if (name === REGISTRATION_PENDING_COLLECTION) return pendingRef;
          if (name === EMAIL_VERIFICATION_CODES_COLLECTION) return codeRef;
          return usernameRef;
        }),
      })),
      runTransaction: jest.fn((callback: (tx: typeof transaction) => Promise<void>) =>
        callback(transaction),
      ),
    } as unknown as Firestore;
    const createUser = jest.fn().mockResolvedValue({ uid: 'uid-1' });
    const mail = makeMail();
    const service = makeService({
      auth: {
        getUserByEmail: jest.fn().mockRejectedValue({ code: 'auth/user-not-found' }),
        createUser,
        deleteUser: jest.fn(),
      },
      firestore,
      mail,
    });

    await expect(
      service.register({
        username: 'rider_one',
        email: 'rider@gmail.com',
        password: 'Password1',
      }),
    ).resolves.toEqual({ email: 'rider@gmail.com' });

    expect(createUser).toHaveBeenCalledWith({
      email: 'rider@gmail.com',
      password: 'Password1',
    });
    expect(mail.sendVerificationCode).toHaveBeenCalledWith(
      'rider@gmail.com',
      expect.stringMatching(/^\d{6}$/),
    );
    const pendingCalls = pendingRef.set.mock.calls as unknown[][];
    const pending = pendingCalls[0]?.[0] as Record<string, unknown>;
    expect(pending).toEqual(
      expect.objectContaining({ uid: 'uid-1', email: 'rider@gmail.com', username: 'rider_one' }),
    );
    expect(JSON.stringify(pending)).not.toContain('Password1');
    const codePayload = codeSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(codePayload.codeHash).toEqual(expect.any(String));
    expect(JSON.stringify(codePayload)).not.toMatch(/"\d{6}"/);
  });

  it('verify success sets emailVerified, finalizes profile, and deletes the code', async () => {
    const code = '123456';
    const codeRef = {
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          codeHash: hash(code, 'uid-1'),
          expiresAt: new Date(Date.now() + 60_000),
          attempts: 0,
          createdAt: new Date(),
          lastSentAt: new Date(),
          consumedAt: null,
        }),
      }),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const pendingRef = {
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          uid: 'uid-1',
          username: 'rider_one',
          email: 'rider@gmail.com',
          expiresAt: { toDate: () => new Date(Date.now() + 60_000) },
        }),
      }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const profileRef = { get: jest.fn().mockResolvedValue({ exists: false }), create: jest.fn() };
    const usernameRef = { set: jest.fn() };
    const firestore = {
      collection: jest.fn((name: string) => ({
        doc: jest.fn(() => {
          if (name === EMAIL_VERIFICATION_CODES_COLLECTION) return codeRef;
          if (name === REGISTRATION_PENDING_COLLECTION) return pendingRef;
          if (name === 'profiles') return profileRef;
          return usernameRef;
        }),
      })),
    } as unknown as Firestore;
    const updateUser = jest.fn().mockResolvedValue(undefined);
    const service = makeService({
      auth: {
        getUserByEmail: jest.fn().mockResolvedValue({
          uid: 'uid-1',
          email: 'rider@gmail.com',
          emailVerified: false,
        }),
        updateUser,
      },
      firestore,
    });

    await expect(
      service.verifyEmailCode({ email: 'rider@gmail.com', code }),
    ).resolves.toEqual({ uid: 'uid-1', email: 'rider@gmail.com' });

    expect(updateUser).toHaveBeenCalledWith('uid-1', { emailVerified: true });
    expect(profileRef.create).toHaveBeenCalled();
    expect(pendingRef.delete).toHaveBeenCalled();
    expect(codeRef.delete).toHaveBeenCalled();
  });

  it('rejects a wrong verification code and increments attempts', async () => {
    const codeRef = {
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          codeHash: hash('123456', 'uid-1'),
          expiresAt: new Date(Date.now() + 60_000),
          attempts: 0,
          createdAt: new Date(),
        }),
      }),
      set: jest.fn(),
      delete: jest.fn(),
    };
    const firestore = {
      collection: jest.fn(() => ({ doc: jest.fn(() => codeRef) })),
    } as unknown as Firestore;
    const service = makeService({
      auth: {
        getUserByEmail: jest.fn().mockResolvedValue({
          uid: 'uid-1',
          email: 'rider@gmail.com',
          emailVerified: false,
        }),
        updateUser: jest.fn(),
      },
      firestore,
    });

    await expect(
      service.verifyEmailCode({ email: 'rider@gmail.com', code: '000000' }),
    ).rejects.toThrow(BadRequestException);
    expect(codeRef.set).toHaveBeenCalledWith({ attempts: 1 }, { merge: true });
    expect(codeRef.delete).not.toHaveBeenCalled();
  });

  it('rejects an expired verification code', async () => {
    const codeRef = {
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          codeHash: hash('123456', 'uid-1'),
          expiresAt: new Date(Date.now() - 1_000),
          attempts: 0,
          createdAt: new Date(Date.now() - 600_000),
        }),
      }),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const firestore = {
      collection: jest.fn(() => ({ doc: jest.fn(() => codeRef) })),
    } as unknown as Firestore;
    const service = makeService({
      auth: {
        getUserByEmail: jest.fn().mockResolvedValue({
          uid: 'uid-1',
          email: 'rider@gmail.com',
          emailVerified: false,
        }),
      },
      firestore,
    });

    await expect(
      service.verifyEmailCode({ email: 'rider@gmail.com', code: '123456' }),
    ).rejects.toThrow('Verification code has expired.');
    expect(codeRef.delete).toHaveBeenCalled();
  });

  it('rejects a second verify after the code was consumed (single-use)', async () => {
    const codeRef = {
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          codeHash: hash('123456', 'uid-1'),
          expiresAt: new Date(Date.now() + 60_000),
          attempts: 0,
          createdAt: new Date(),
          consumedAt: new Date(),
        }),
      }),
      set: jest.fn(),
      delete: jest.fn(),
    };
    const firestore = {
      collection: jest.fn(() => ({ doc: jest.fn(() => codeRef) })),
    } as unknown as Firestore;
    const service = makeService({
      auth: {
        getUserByEmail: jest.fn().mockResolvedValue({
          uid: 'uid-1',
          email: 'rider@gmail.com',
          emailVerified: false,
        }),
      },
      firestore,
    });

    await expect(
      service.verifyEmailCode({ email: 'rider@gmail.com', code: '123456' }),
    ).rejects.toThrow('Invalid verification code.');
  });

  it('invalidates the code when attempts are exceeded', async () => {
    const codeRef = {
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          codeHash: hash('123456', 'uid-1'),
          expiresAt: new Date(Date.now() + 60_000),
          attempts: 4,
          createdAt: new Date(),
        }),
      }),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const firestore = {
      collection: jest.fn(() => ({ doc: jest.fn(() => codeRef) })),
    } as unknown as Firestore;
    const service = makeService({
      auth: {
        getUserByEmail: jest.fn().mockResolvedValue({
          uid: 'uid-1',
          email: 'rider@gmail.com',
          emailVerified: false,
        }),
      },
      firestore,
    });

    let caught: unknown;
    try {
      await service.verifyEmailCode({ email: 'rider@gmail.com', code: '000000' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(codeRef.delete).toHaveBeenCalled();
  });

  it('rejects resend within the server-side cooldown', async () => {
    const codeRef = {
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          codeHash: 'abc',
          expiresAt: new Date(Date.now() + 60_000),
          attempts: 0,
          createdAt: new Date(),
          lastSentAt: new Date(),
        }),
      }),
      set: jest.fn(),
      delete: jest.fn(),
    };
    const firestore = {
      collection: jest.fn(() => ({ doc: jest.fn(() => codeRef) })),
    } as unknown as Firestore;
    const mail = makeMail();
    const service = makeService({
      auth: {
        getUserByEmail: jest.fn().mockResolvedValue({
          uid: 'uid-1',
          email: 'rider@gmail.com',
          emailVerified: false,
        }),
      },
      firestore,
      mail,
    });

    await expect(service.resendVerificationCode({ email: 'rider@gmail.com' })).rejects.toThrow(
      HttpException,
    );
    expect(mail.sendVerificationCode).not.toHaveBeenCalled();
  });

  it('resend after cooldown succeeds and invalidates the prior code', async () => {
    const codeSet = jest.fn().mockResolvedValue(undefined);
    const codeDelete = jest.fn().mockResolvedValue(undefined);
    const codeRef = {
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          codeHash: 'old-hash',
          expiresAt: new Date(Date.now() + 60_000),
          attempts: 2,
          createdAt: new Date(Date.now() - 120_000),
          lastSentAt: new Date(Date.now() - 120_000),
        }),
      }),
      set: codeSet,
      delete: codeDelete,
    };
    const firestore = {
      collection: jest.fn(() => ({ doc: jest.fn(() => codeRef) })),
    } as unknown as Firestore;
    const mail = makeMail();
    const service = makeService({
      auth: {
        getUserByEmail: jest.fn().mockResolvedValue({
          uid: 'uid-1',
          email: 'rider@gmail.com',
          emailVerified: false,
        }),
      },
      firestore,
      mail,
    });

    await expect(service.resendVerificationCode({ email: 'rider@gmail.com' })).resolves.toEqual({
      email: 'rider@gmail.com',
    });
    expect(codeDelete).toHaveBeenCalled();
    expect(mail.sendVerificationCode).toHaveBeenCalledWith(
      'rider@gmail.com',
      expect.stringMatching(/^\d{6}$/),
    );
    expect(codeSet).toHaveBeenCalled();
  });

  it('rejects verify when the email is already verified', async () => {
    const service = makeService({
      auth: {
        getUserByEmail: jest.fn().mockResolvedValue({
          uid: 'uid-1',
          email: 'rider@gmail.com',
          emailVerified: true,
        }),
      },
    });

    await expect(
      service.verifyEmailCode({ email: 'rider@gmail.com', code: '123456' }),
    ).rejects.toThrow(ConflictException);
  });

  it('no longer exposes verifyRegistration (link-flow finalization removed)', () => {
    const service = makeService({});
    expect(
      (service as unknown as { verifyRegistration?: unknown }).verifyRegistration,
    ).toBeUndefined();
  });
});
