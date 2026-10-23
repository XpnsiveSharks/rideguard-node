import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import type { Rest } from 'ably';

import { AuthService } from './auth.service';
import { REGISTRATION_PENDING_COLLECTION } from './registration.constants';

describe('AuthService email-link registration', () => {
  function makeConfig() {
    return {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          FIREBASE_AUTH_API_BASE_URL: 'https://identitytoolkit.googleapis.com/v1',
          FIREBASE_WEB_API_KEY: 'web-key',
        };
        return values[key];
      }),
    } as never;
  }

  it('creates an unverified Firebase user without sending email from the backend', async () => {
    const pendingRef = { set: jest.fn(), delete: jest.fn() };
    const usernameRef = { delete: jest.fn() };
    const transaction = {
      get: jest.fn().mockResolvedValue({ exists: false }),
      set: jest.fn(),
    };
    const firestore = {
      collection: jest.fn((name: string) => ({
        doc: jest.fn(() => (name === REGISTRATION_PENDING_COLLECTION ? pendingRef : usernameRef)),
      })),
      runTransaction: jest.fn((callback: (tx: typeof transaction) => Promise<void>) =>
        callback(transaction),
      ),
    } as unknown as Firestore;
    const createUser = jest.fn().mockResolvedValue({ uid: 'uid-1' });
    const auth = {
      getUserByEmail: jest.fn().mockRejectedValue({ code: 'auth/user-not-found' }),
      createUser,
      deleteUser: jest.fn(),
    } as unknown as Auth;
    const service = new AuthService(auth, {} as Rest, firestore, makeConfig());

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
    const pendingCalls = pendingRef.set.mock.calls as unknown[][];
    const pending = pendingCalls[0]?.[0] as Record<string, unknown>;
    expect(pending).toEqual(
      expect.objectContaining({ uid: 'uid-1', email: 'rider@gmail.com', username: 'rider_one' }),
    );
    expect(JSON.stringify(pending)).not.toContain('Password1');
  });

  it('finalizes the profile only for a verified Firebase token', async () => {
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
      delete: jest.fn(),
    };
    const profileRef = { get: jest.fn().mockResolvedValue({ exists: false }), create: jest.fn() };
    const usernameRef = { set: jest.fn() };
    const firestore = {
      collection: jest.fn((name: string) => ({
        doc: jest.fn(() =>
          name === REGISTRATION_PENDING_COLLECTION
            ? pendingRef
            : name === 'profiles'
              ? profileRef
              : usernameRef,
        ),
      })),
    } as unknown as Firestore;
    const auth = {
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'uid-1',
        email: 'rider@gmail.com',
        email_verified: true,
      }),
      getUser: jest.fn().mockResolvedValue({
        uid: 'uid-1',
        email: 'rider@gmail.com',
        emailVerified: true,
      }),
    } as unknown as Auth;
    const service = new AuthService(auth, {} as Rest, firestore, makeConfig());

    await expect(service.verifyRegistration('Bearer verified-token')).resolves.toEqual({
      uid: 'uid-1',
      email: 'rider@gmail.com',
    });
    expect(profileRef.create).toHaveBeenCalled();
    expect(pendingRef.delete).toHaveBeenCalled();
  });

  it('rejects verification finalization for an unverified token', async () => {
    const auth = {
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'uid-1',
        email: 'rider@gmail.com',
        email_verified: false,
      }),
      getUser: jest.fn().mockResolvedValue({
        uid: 'uid-1',
        email: 'rider@gmail.com',
        emailVerified: false,
      }),
    } as unknown as Auth;
    const service = new AuthService(auth, {} as Rest, {} as Firestore, makeConfig());

    await expect(service.verifyRegistration('Bearer unverified-token')).rejects.toThrow(
      'Email verification has not been completed.',
    );
  });
});
