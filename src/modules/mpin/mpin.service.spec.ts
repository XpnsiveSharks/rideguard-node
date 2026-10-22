import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { MpinService, MPIN_EMAIL_SENDER, MpinEmailSender } from './mpin.service';
import type { Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import {
  MPIN_ACCOUNTS,
  MPIN_CHALLENGES,
  MPIN_GRANTS,
  MPIN_LOCK_MS,
} from './mpin.constants';

describe('MpinService', () => {
  let service: MpinService;
  let mockFirestore: jest.Mocked<Firestore>;
  let mockAuth: jest.Mocked<Auth>;
  let mockEmailSender: jest.Mocked<MpinEmailSender>;
  const store = new Map<string, Map<string, any>>();

  function getDoc(coll: string, id: string) {
    if (!store.has(coll)) store.set(coll, new Map());
    return store.get(coll)!.get(id);
  }

  function setDoc(coll: string, id: string, data: any, options?: { merge?: boolean }) {
    if (!store.has(coll)) store.set(coll, new Map());
    const c = store.get(coll)!;
    const existing = c.get(id) || {};
    if (options?.merge) {
      c.set(id, { ...existing, ...data });
    } else {
      c.set(id, data);
    }
  }

  beforeEach(() => {
    store.clear();

    mockFirestore = {
      collection: jest.fn((collName: string) => ({
        doc: jest.fn((docId: string) => ({
          get: jest.fn(async () => {
            const data = getDoc(collName, docId);
            return {
              exists: !!data,
              data: () => (data ? { ...data } : undefined),
            };
          }),
          set: jest.fn(async (data: any, options?: any) => {
            setDoc(collName, docId, data, options);
          }),
        })),
      })),
    } as unknown as jest.Mocked<Firestore>;

    mockAuth = {
      getUser: jest.fn(async (uid: string) => ({
        uid,
        email: 'user@gmail.com',
        emailVerified: true,
      })),
    } as unknown as jest.Mocked<Auth>;

    mockEmailSender = {
      sendCode: jest.fn(async (_to: string, _code: string, _purpose: 'change' | 'recovery') => {}),
    };

    service = new MpinService(mockFirestore, mockAuth, mockEmailSender);
  });

  describe('create and status', () => {
    it('returns unconfigured status when no PIN is set', async () => {
      const res = await service.status('uid-1');
      expect(res.configured).toBe(false);
      expect(res.requiresUnlock).toBe(false);
      expect(res.remainingAttempts).toBe(5);
      expect(res.locked).toBe(false);
    });

    it('creates MPIN securely and rejects duplicate creation', async () => {
      const res = await service.create('uid-1', '1234');
      expect(res).toEqual({ success: true });

      const saved = getDoc(MPIN_ACCOUNTS, 'uid-1');
      expect(saved.pinHash).toMatch(/^scrypt\$/);

      await expect(service.create('uid-1', '5678')).rejects.toThrow(ConflictException);
    });
  });

  describe('unlock and lockouts', () => {
    beforeEach(async () => {
      await service.create('uid-1', '1234');
    });

    it('unlocks with correct PIN', async () => {
      const res = await service.unlock('uid-1', '1234');
      expect(res).toEqual({ success: true });

      const st = await service.status('uid-1');
      expect(st.requiresUnlock).toBe(false);
      expect(st.unlockExpiresAt).toBeDefined();
    });

    it('locks account after 5 failed attempts for 15 minutes', async () => {
      for (let i = 0; i < 4; i++) {
        await expect(service.unlock('uid-1', '0000')).rejects.toThrow(UnauthorizedException);
      }
      // 5th attempt locks
      await expect(service.unlock('uid-1', '0000')).rejects.toThrow(UnauthorizedException);

      const st = await service.status('uid-1');
      expect(st.locked).toBe(true);
      expect(st.remainingAttempts).toBe(0);

      // Subsequent attempt returns 429
      await expect(service.unlock('uid-1', '1234')).rejects.toThrow(HttpException);
    });
  });

  describe('change and single-use grant', () => {
    beforeEach(async () => {
      await service.create('uid-1', '1234');
    });

    it('enforces lockout on authorizeChange failed guesses', async () => {
      for (let i = 0; i < 5; i++) {
        await expect(service.authorizeChange('uid-1', '0000')).rejects.toThrow(UnauthorizedException);
      }
      const st = await service.status('uid-1');
      expect(st.locked).toBe(true);
      await expect(service.authorizeChange('uid-1', '1234')).rejects.toThrow(HttpException);
    });

    it('completes change flow and prevents grant replay', async () => {
      const auth = await service.authorizeChange('uid-1', '1234');
      const challenge = await service.requestChangeCode('uid-1', auth.token);
      expect(challenge.maskedDestination).toBe('u***@gmail.com');

      // Attempting to reuse change-proof grant fails
      await expect(service.requestChangeCode('uid-1', auth.token)).rejects.toThrow(
        UnauthorizedException,
      );

      // Verify code from email
      const sentCode = mockEmailSender.sendCode.mock.calls[0][1];
      const changeGrant = await service.verifyChangeCode('uid-1', challenge.challengeId, sentCode);

      // Change PIN
      const res = await service.change('uid-1', changeGrant.token, '9876');
      expect(res).toEqual({ success: true });

      // Grant cannot be reused
      await expect(service.change('uid-1', changeGrant.token, '1111')).rejects.toThrow(
        UnauthorizedException,
      );

      // New PIN unlocks
      await expect(service.unlock('uid-1', '9876')).resolves.toEqual({ success: true });
    });
  });

  describe('recovery flow', () => {
    beforeEach(async () => {
      await service.create('uid-1', '1234');
    });

    it('sends recovery code and enforces resend cooldown', async () => {
      const challenge = await service.requestRecovery('uid-1');
      expect(mockEmailSender.sendCode).toHaveBeenCalledWith('user@gmail.com', expect.any(String), 'recovery');

      // Resend too early throws 429
      await expect(service.resendRecovery('uid-1', challenge.challengeId)).rejects.toThrow(HttpException);
    });

    it('rejects invalid or expired recovery codes', async () => {
      const challenge = await service.requestRecovery('uid-1');
      await expect(service.verifyRecovery('uid-1', challenge.challengeId, '000000')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
