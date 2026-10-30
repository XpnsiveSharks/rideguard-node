/* eslint-disable @typescript-eslint/unbound-method */
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import type { Rest } from 'ably';
import { AuthService } from './auth.service';
import { FirebaseAuthGuard } from './guards/firebase-auth.guard';
import { AccountDeletionProcessorService } from './account-deletion-processor.service';
import { ALLOW_DURING_DELETION_KEY } from './account-deletion.decorator';

describe('Account Deletion & Grace Period', () => {
  function makeConfig(custom: Record<string, unknown> = {}) {
    const values: Record<string, unknown> = {
      FIREBASE_AUTH_API_BASE_URL: 'https://identitytoolkit.googleapis.com/v1',
      FIREBASE_WEB_API_KEY: 'test-api-key',
      ACCOUNT_DELETION_GRACE_DAYS: 30,
      ACCOUNT_DELETION_ENABLED: true,
      ...custom,
    };
    return {
      get: jest.fn((key: string) => values[key]),
    } as never;
  }

  describe('AuthService deletion endpoints', () => {
    let originalFetch: typeof global.fetch;

    beforeAll(() => {
      originalFetch = global.fetch;
    });

    afterAll(() => {
      global.fetch = originalFetch;
    });

    it('requestAccountDeletion schedules deletion, revokes tokens, and disables user on valid password', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ localId: 'user-123', email: 'user@gmail.com' }),
      });

      const profileSet = jest.fn().mockResolvedValue(undefined);
      const profileRef = { set: profileSet };
      const firestore = {
        collection: jest.fn(() => ({
          doc: jest.fn(() => profileRef),
        })),
      } as unknown as Firestore;

      const auth = {
        getUser: jest.fn().mockResolvedValue({ uid: 'user-123', email: 'user@gmail.com' }),
        revokeRefreshTokens: jest.fn().mockResolvedValue(undefined),
        updateUser: jest.fn().mockResolvedValue(undefined),
      } as unknown as Auth;

      const service = new AuthService(auth, {} as Rest, firestore, makeConfig(), {
        sendVerificationCode: jest.fn(),
      } as never);
      const result = await service.requestAccountDeletion('user-123', 'Password123');

      expect(result.scheduled).toBe(true);
      expect(result.deletionScheduledAt).toBeDefined();
      expect(profileSet).toHaveBeenCalledWith(
        expect.objectContaining({
          deletionScheduledAt: expect.any(Date) as Date,
        }),
        { merge: true },
      );
      expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('user-123');
      expect(auth.updateUser).toHaveBeenCalledWith('user-123', { disabled: true });
    });

    it('requestAccountDeletion throws UnauthorizedException on incorrect password', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: { message: 'INVALID_PASSWORD' } }),
      });

      const auth = {
        getUser: jest.fn().mockResolvedValue({ uid: 'user-123', email: 'user@gmail.com' }),
        revokeRefreshTokens: jest.fn(),
        updateUser: jest.fn(),
      } as unknown as Auth;

      const service = new AuthService(auth, {} as Rest, {} as Firestore, makeConfig(), {
        sendVerificationCode: jest.fn(),
      } as never);

      await expect(service.requestAccountDeletion('user-123', 'WrongPass')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(auth.revokeRefreshTokens).not.toHaveBeenCalled();
      expect(auth.updateUser).not.toHaveBeenCalled();
    });

    it('cancelAccountDeletion clears deletionScheduledAt and re-enables user', async () => {
      const profileSet = jest.fn().mockResolvedValue(undefined);
      const profileRef = { set: profileSet };
      const firestore = {
        collection: jest.fn(() => ({
          doc: jest.fn(() => profileRef),
        })),
      } as unknown as Firestore;

      const auth = {
        updateUser: jest.fn().mockResolvedValue(undefined),
      } as unknown as Auth;

      const service = new AuthService(auth, {} as Rest, firestore, makeConfig(), {
        sendVerificationCode: jest.fn(),
      } as never);
      const result = await service.cancelAccountDeletion('user-123');

      expect(result.scheduled).toBe(false);
      expect(profileSet).toHaveBeenCalledWith(
        expect.objectContaining({
          deletionScheduledAt: expect.anything() as unknown,
        }),
        { merge: true },
      );
      expect(auth.updateUser).toHaveBeenCalledWith('user-123', { disabled: false });
    });

    it('getDeletionStatus returns scheduled: true with ISO date when scheduled', async () => {
      const scheduledDate = new Date('2026-11-25T00:00:00.000Z');
      const profileRef = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ deletionScheduledAt: scheduledDate }),
        }),
      };
      const firestore = {
        collection: jest.fn(() => ({
          doc: jest.fn(() => profileRef),
        })),
      } as unknown as Firestore;

      const service = new AuthService({} as Auth, {} as Rest, firestore, makeConfig(), {
        sendVerificationCode: jest.fn(),
      } as never);
      const result = await service.getDeletionStatus('user-123');

      expect(result.scheduled).toBe(true);
      expect(result.deletionScheduledAt).toBe(scheduledDate.toISOString());
    });

    it('getDeletionStatus returns scheduled: false when not scheduled', async () => {
      const profileRef = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({}),
        }),
      };
      const firestore = {
        collection: jest.fn(() => ({
          doc: jest.fn(() => profileRef),
        })),
      } as unknown as Firestore;

      const service = new AuthService({} as Auth, {} as Rest, firestore, makeConfig(), {
        sendVerificationCode: jest.fn(),
      } as never);
      const result = await service.getDeletionStatus('user-123');

      expect(result.scheduled).toBe(false);
      expect(result.deletionScheduledAt).toBeNull();
    });
  });

  describe('FirebaseAuthGuard grace-period behavior', () => {
    let authService: AuthService;
    let isDeletionScheduledMock: jest.Mock<Promise<boolean>, [string]>;
    let reflector: jest.Mocked<Reflector>;
    let guard: FirebaseAuthGuard;

    beforeEach(() => {
      isDeletionScheduledMock = jest.fn<Promise<boolean>, [string]>();
      authService = {
        verifyToken: jest.fn().mockResolvedValue({
          uid: 'user-123',
          email_verified: true,
        }),
        isDeletionScheduled: isDeletionScheduledMock,
      } as unknown as AuthService;
      reflector = {
        getAllAndOverride: jest.fn(),
      } as unknown as jest.Mocked<Reflector>;
      guard = new FirebaseAuthGuard(authService, reflector);
    });

    function makeContext(
      headers: Record<string, string> = { authorization: 'Bearer valid-token' },
    ) {
      const request = { headers, user: undefined };
      return {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as unknown as ExecutionContext;
    }

    it('blocks normal authenticated routes when account deletion is scheduled', async () => {
      reflector.getAllAndOverride.mockImplementation((key) => {
        if (key === ALLOW_DURING_DELETION_KEY) return false;
        return false;
      });
      isDeletionScheduledMock.mockResolvedValue(true);

      const context = makeContext();
      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('allows routes decorated with @AllowDuringDeletion() even when deletion is scheduled', async () => {
      reflector.getAllAndOverride.mockImplementation((key) => {
        if (key === ALLOW_DURING_DELETION_KEY) return true;
        return false;
      });
      isDeletionScheduledMock.mockResolvedValue(true);

      const context = makeContext();
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(isDeletionScheduledMock).not.toHaveBeenCalled();
    });

    it('allows normal authenticated routes when account deletion is not scheduled', async () => {
      reflector.getAllAndOverride.mockImplementation(() => false);
      isDeletionScheduledMock.mockResolvedValue(false);

      const context = makeContext();
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe('AccountDeletionProcessorService processor sweep', () => {
    it('sweeps due accounts and deletes data across collections idempotently', async () => {
      const mockBatch = {
        delete: jest.fn(),
        commit: jest.fn().mockResolvedValue(undefined),
      };

      const mockEmergencyContactsQuery = {
        get: jest.fn().mockResolvedValue({
          empty: false,
          size: 1,
          docs: [{ ref: { id: 'contact-1' } }],
        }),
      };
      const mockPushQuery = {
        get: jest.fn().mockResolvedValue({
          empty: false,
          size: 1,
          docs: [{ ref: { id: 'push-1' } }],
        }),
      };
      const mockPhoneSessionsQuery = {
        get: jest.fn().mockResolvedValue({
          empty: true,
          docs: [],
        }),
      };
      const mockSosQuery = {
        get: jest.fn().mockResolvedValue({
          empty: true,
          docs: [],
        }),
      };
      const mockSosRequestsQuery = {
        get: jest.fn().mockResolvedValue({
          empty: true,
          docs: [],
        }),
      };
      const mockUsernamesQuery = {
        get: jest.fn().mockResolvedValue({
          empty: false,
          size: 1,
          docs: [{ ref: { id: 'rider_one' } }],
        }),
      };
      const mockPendingQuery = {
        get: jest.fn().mockResolvedValue({
          empty: true,
          docs: [],
        }),
      };

      const mockDeviceDocPhone = {
        id: 'CAM-phone-1',
        data: () => ({ source: 'phone' }),
        ref: { delete: jest.fn().mockResolvedValue(undefined) },
      };
      const mockDeviceDocHardware = {
        id: 'CAM-hw-1',
        data: () => ({ source: 'hardware' }),
        ref: { update: jest.fn().mockResolvedValue(undefined) },
      };
      const mockDevicesQuery = {
        get: jest.fn().mockResolvedValue({
          docs: [mockDeviceDocPhone, mockDeviceDocHardware],
        }),
      };

      const profileDelete = jest.fn().mockResolvedValue(undefined);
      const sosActiveDelete = jest.fn().mockResolvedValue(undefined);
      const usernameDelete = jest.fn().mockResolvedValue(undefined);

      const firestore = {
        batch: () => mockBatch,
        collection: jest.fn((col: string) => {
          if (col === 'emergency_contacts') {
            return { where: () => mockEmergencyContactsQuery };
          }
          if (col === 'push_registrations') {
            return { where: () => mockPushQuery };
          }
          if (col === 'phone-sessions') {
            return { where: () => mockPhoneSessionsQuery };
          }
          if (col === 'sos') {
            return { where: () => mockSosQuery };
          }
          if (col === 'sos_requests') {
            return {
              where: () => ({
                where: () => mockSosRequestsQuery,
              }),
            };
          }
          if (col === 'devices') {
            return { where: () => mockDevicesQuery };
          }
          if (col === 'usernames') {
            return {
              doc: () => ({
                get: () =>
                  Promise.resolve({
                    exists: true,
                    data: () => ({ uid: 'user-1' }),
                    ref: { delete: usernameDelete },
                  }),
              }),
              where: () => mockUsernamesQuery,
            };
          }
          if (col === 'pending_registrations') {
            return { where: () => mockPendingQuery };
          }
          if (col === 'sos_active') {
            return { doc: () => ({ delete: sosActiveDelete }) };
          }
          if (col === 'profiles') {
            return {
              where: () => ({
                get: () =>
                  Promise.resolve({
                    empty: false,
                    docs: [
                      {
                        id: 'user-1',
                        data: () => ({ username: 'rider_one' }),
                      },
                    ],
                  }),
              }),
              doc: () => ({ delete: profileDelete }),
            };
          }
          return {
            where: () => ({ get: () => Promise.resolve({ empty: true, docs: [] }) }),
            doc: () => ({ delete: jest.fn() }),
          };
        }),
      } as unknown as Firestore;

      const auth = {
        deleteUser: jest.fn().mockResolvedValue(undefined),
      } as unknown as Auth;

      const processor = new AccountDeletionProcessorService(auth, firestore, makeConfig());

      await processor.run();

      expect(auth.deleteUser).toHaveBeenCalledWith('user-1');
      expect(profileDelete).toHaveBeenCalled();
      expect(mockDeviceDocPhone.ref.delete).toHaveBeenCalled();
      expect(mockDeviceDocHardware.ref.update).toHaveBeenCalledWith({ assignedUserId: null });
      expect(mockBatch.commit).toHaveBeenCalled();
    });

    it('tolerates partial failures and already-deleted Firebase users gracefully', async () => {
      const profileDelete = jest.fn().mockResolvedValue(undefined);
      const firestore = {
        batch: () => ({ delete: jest.fn(), commit: jest.fn().mockResolvedValue(undefined) }),
        collection: jest.fn((col: string) => {
          if (col === 'profiles') {
            return {
              where: () => ({
                get: () =>
                  Promise.resolve({
                    empty: false,
                    docs: [{ id: 'user-already-deleted', data: () => ({}) }],
                  }),
              }),
              doc: () => ({ delete: profileDelete }),
            };
          }
          return {
            where: () => ({
              where: () => ({ get: () => Promise.resolve({ empty: true, docs: [] }) }),
              get: () => Promise.resolve({ empty: true, docs: [] }),
            }),
            doc: () => ({ delete: jest.fn().mockResolvedValue(undefined) }),
          };
        }),
      } as unknown as Firestore;

      const auth = {
        deleteUser: jest.fn().mockRejectedValue({ code: 'auth/user-not-found' }),
      } as unknown as Auth;

      const processor = new AccountDeletionProcessorService(auth, firestore, makeConfig());

      // Should not throw despite user already missing from Firebase Auth
      await expect(processor.run()).resolves.toBeUndefined();
      expect(profileDelete).toHaveBeenCalled();
    });
  });
});
