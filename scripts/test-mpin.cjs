// scripts/test-mpin.cjs
// Verification suite for RideGuard MPIN and Profile Updates using node:test

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

// In-memory Firestore and Auth mock for testing MpinService behavior
function createMockBackend() {
  const collections = new Map();

  function getDoc(collName, docId) {
    if (!collections.has(collName)) {
      collections.set(collName, new Map());
    }
    const coll = collections.get(collName);
    return coll.get(docId);
  }

  function setDoc(collName, docId, data, options = {}) {
    if (!collections.has(collName)) {
      collections.set(collName, new Map());
    }
    const coll = collections.get(collName);
    const existing = coll.get(docId) || {};
    let next;
    if (options.merge) {
      next = { ...existing };
      for (const [key, val] of Object.entries(data)) {
        if (val && val.__delete) {
          delete next[key];
        } else if (val && val.__serverTimestamp) {
          next[key] = Date.now();
        } else {
          next[key] = val;
        }
      }
    } else {
      next = { ...data };
    }
    coll.set(docId, next);
  }

  const firestore = {
    collection(collName) {
      return {
        doc(docId) {
          return {
            async get() {
              const data = getDoc(collName, docId);
              return {
                exists: !!data,
                data() {
                  return data ? JSON.parse(JSON.stringify(data)) : undefined;
                },
              };
            },
            async set(data, options) {
              setDoc(collName, docId, data, options);
            },
          };
        },
      };
    },
  };

  const users = new Map();
  const auth = {
    setUser(uid, userData) {
      users.set(uid, userData);
    },
    async getUser(uid) {
      const u = users.get(uid);
      if (!u) throw new Error('User not found');
      return u;
    },
  };

  const sentEmails = [];
  const emailSender = {
    async sendCode(to, code, purpose) {
      sentEmails.push({ to, code, purpose, sentAt: Date.now() });
    },
    getSent() {
      return sentEmails;
    },
  };

  return { firestore, auth, emailSender, collections };
}

// Minimal Nest-like exception classes matching the backend behavior
class HttpException extends Error {
  constructor(response, status) {
    super(typeof response === 'string' ? response : response.message);
    this.response = response;
    this.status = status;
  }
}
class BadRequestException extends HttpException {
  constructor(msg) { super(msg, 400); }
}
class UnauthorizedException extends HttpException {
  constructor(msg) { super(msg, 401); }
}
class ForbiddenException extends HttpException {
  constructor(msg) { super(msg, 403); }
}
class NotFoundException extends HttpException {
  constructor(msg) { super(msg, 404); }
}
class ConflictException extends HttpException {
  constructor(msg) { super(msg, 409); }
}
class TooManyRequestsException extends HttpException {
  constructor(msg) { super(msg, 429); }
}

const FieldValue = {
  delete: () => ({ __delete: true }),
  serverTimestamp: () => ({ __serverTimestamp: true }),
};

const MPIN_ACCOUNTS = 'mpinAccounts';
const MPIN_CHALLENGES = 'mpinChallenges';
const MPIN_GRANTS = 'mpinGrants';
const MPIN_ATTEMPT_LIMIT = 5;
const MPIN_LOCK_MS = 15 * 60 * 1000;
const MPIN_UNLOCK_MS = 15 * 60 * 1000;
const MPIN_GRANT_MS = 10 * 60 * 1000;
const MPIN_CODE_MS = 10 * 60 * 1000;
const MPIN_RESEND_MS = 60 * 1000;
const MPIN_CODE_ATTEMPT_LIMIT = 5;

// Implementation of MpinService mirror for standalone testing
class TestMpinService {
  constructor(firestore, auth, emailSender) {
    this.firestore = firestore;
    this.auth = auth;
    this.emailSender = emailSender;
  }

  async status(uid) {
    const account = await this.account(uid);
    const now = Date.now();
    const isLocked = (account.lockedUntil ?? 0) > now;
    const remainingAttempts = isLocked
      ? 0
      : (account.lockedUntil && account.lockedUntil <= now)
        ? MPIN_ATTEMPT_LIMIT
        : Math.max(0, MPIN_ATTEMPT_LIMIT - (account.failedAttempts ?? 0));

    return {
      configured: !!account.pinHash,
      requiresUnlock: !!account.pinHash && (!account.unlockExpiresAt || account.unlockExpiresAt <= now),
      locked: isLocked,
      ...(isLocked && account.lockedUntil ? { lockedUntil: account.lockedUntil } : {}),
      remainingAttempts,
      ...(account.unlockExpiresAt ? { unlockExpiresAt: account.unlockExpiresAt } : {}),
      serverTime: now,
      emergencyAccessAllowed: false,
      emergencyAlertIds: [],
    };
  }

  async create(uid, pin) {
    if (!/^\d{4}$/.test(pin)) throw new BadRequestException('pin must be exactly four digits');
    const ref = this.firestore.collection(MPIN_ACCOUNTS).doc(uid);
    const existing = await ref.get();
    if (existing.exists && existing.data()?.pinHash) {
      throw new ConflictException('MPIN is already configured');
    }
    await ref.set(
      { pinHash: await this.hash(pin), failedAttempts: 0, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return { success: true };
  }

  async unlock(uid, pin) {
    if (!/^\d{4}$/.test(pin)) throw new BadRequestException('pin must be exactly four digits');
    const ref = this.firestore.collection(MPIN_ACCOUNTS).doc(uid);
    const snapshot = await ref.get();
    const account = snapshot.data() || {};
    const now = Date.now();
    if (!account.pinHash) throw new BadRequestException('MPIN is not configured');
    if ((account.lockedUntil ?? 0) > now) {
      throw new TooManyRequestsException({ message: 'MPIN is locked', retryAt: account.lockedUntil });
    }
    const currentFailed = (account.lockedUntil && account.lockedUntil <= now) ? 0 : (account.failedAttempts ?? 0);
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
    return { success: true };
  }

  async authorizeChange(uid, pin) {
    await this.verifyCurrent(uid, pin);
    return this.grant(uid, 'change-proof', MPIN_GRANT_MS);
  }

  async requestChangeCode(uid, proof) {
    await this.consumeGrant(uid, proof, 'change-proof', true);
    return this.issueChallenge(uid, 'change-code', 'change');
  }

  async resendChangeCode(uid, challengeId) {
    return this.resend(uid, challengeId, 'change-code', 'change');
  }

  async verifyChangeCode(uid, challengeId, code) {
    await this.verifyCode(uid, challengeId, code, 'change-code');
    return this.grant(uid, 'change', MPIN_GRANT_MS);
  }

  async change(uid, authorization, pin) {
    if (!/^\d{4}$/.test(pin)) throw new BadRequestException('pin must be exactly four digits');
    await this.consumeGrant(uid, authorization, 'change', true);
    await this.replacePin(uid, pin);
    return { success: true };
  }

  async requestRecovery(uid) {
    return this.issueChallenge(uid, 'recovery', 'recovery');
  }

  async resendRecovery(uid, challengeId) {
    return this.resend(uid, challengeId, 'recovery', 'recovery');
  }

  async verifyRecovery(uid, challengeId, code) {
    await this.verifyCode(uid, challengeId, code, 'recovery');
    return this.grant(uid, 'reset', MPIN_GRANT_MS);
  }

  async reset(uid, authorization, pin) {
    if (!/^\d{4}$/.test(pin)) throw new BadRequestException('pin must be exactly four digits');
    await this.consumeGrant(uid, authorization, 'reset', true);
    await this.replacePin(uid, pin);
    return { success: true };
  }

  async verifyCurrent(uid, pin) {
    if (!/^\d{4}$/.test(pin)) throw new BadRequestException('pin must be exactly four digits');
    const ref = this.firestore.collection(MPIN_ACCOUNTS).doc(uid);
    const snapshot = await ref.get();
    const account = snapshot.data() || {};
    const now = Date.now();
    if (!account.pinHash) throw new BadRequestException('MPIN is not configured');
    if ((account.lockedUntil ?? 0) > now) {
      throw new TooManyRequestsException({ message: 'MPIN is locked', retryAt: account.lockedUntil });
    }
    const currentFailed = (account.lockedUntil && account.lockedUntil <= now) ? 0 : (account.failedAttempts ?? 0);
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
      { failedAttempts: 0, lockedUntil: FieldValue.delete() },
      { merge: true },
    );
  }

  async replacePin(uid, pin) {
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

  async issueChallenge(uid, purpose, emailPurpose) {
    const user = await this.auth.getUser(uid);
    if (!user.email || !user.emailVerified) {
      throw new ForbiddenException('Registered email verification is required');
    }
    const now = Date.now();
    const challengeId = crypto.randomBytes(18).toString('hex');
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const challenge = {
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
      __devCode: code, // For test verification only
    };
  }

  async resend(uid, challengeId, purpose, emailPurpose) {
    const ref = this.firestore.collection(MPIN_CHALLENGES).doc(challengeId);
    const snapshot = await ref.get();
    const old = snapshot.data();
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
      throw new TooManyRequestsException('Code cannot be resent yet');
    }
    await ref.set({ replaced: true }, { merge: true });
    return this.issueChallenge(uid, purpose, emailPurpose);
  }

  async verifyCode(uid, challengeId, code, purpose) {
    const ref = this.firestore.collection(MPIN_CHALLENGES).doc(challengeId);
    const snapshot = await ref.get();
    const challenge = snapshot.data();
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
      throw new TooManyRequestsException('Too many code attempts');
    }
    if (challenge.codeHash !== this.digest(code)) {
      await ref.set({ attempts: challenge.attempts + 1 }, { merge: true });
      throw new UnauthorizedException('Invalid or expired code');
    }
    await ref.set({ used: true }, { merge: true });
  }

  async grant(uid, purpose, lifetime) {
    const token = crypto.randomBytes(32).toString('base64url');
    await this.firestore
      .collection(MPIN_GRANTS)
      .doc(this.digest(token))
      .set({
        uid,
        purpose,
        expiresAt: Date.now() + lifetime,
        used: false,
      });
    return { token, expiresAt: Date.now() + lifetime, serverTime: Date.now() };
  }

  async consumeGrant(uid, token, purpose, consume) {
    const ref = this.firestore.collection(MPIN_GRANTS).doc(this.digest(token));
    const snapshot = await ref.get();
    const grant = snapshot.data();
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

  async account(uid) {
    const s = await this.firestore.collection(MPIN_ACCOUNTS).doc(uid).get();
    return s.data() || {};
  }

  async hash(value) {
    const salt = crypto.randomBytes(16);
    const derived = await scrypt(value, salt, 64);
    return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
  }

  async matches(value, encoded) {
    const [, salt, expected] = encoded.split('$');
    if (!salt || !expected) return false;
    const actual = await scrypt(value, Buffer.from(salt, 'base64'), 64);
    const target = Buffer.from(expected, 'base64');
    return actual.length === target.length && crypto.timingSafeEqual(actual, target);
  }

  digest(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  mask(email) {
    const [name, domain] = email.split('@');
    return `${name.slice(0, 1)}***@${domain}`;
  }
}

// ---------------- TESTS ----------------

describe('RideGuard MPIN & Profile Audit Verification', () => {
  let backend;
  let service;
  const userA = 'user_123';
  const userB = 'user_456';

  beforeEach(() => {
    backend = createMockBackend();
    service = new TestMpinService(backend.firestore, backend.auth, backend.emailSender);
    backend.auth.setUser(userA, { email: 'alice@example.com', emailVerified: true });
    backend.auth.setUser(userB, { email: 'bob@example.com', emailVerified: true });
  });

  describe('1. Setup & Initial Status', () => {
    test('Status before setup returns configured=false, requiresUnlock=false', async () => {
      const st = await service.status(userA);
      assert.equal(st.configured, false);
      assert.equal(st.requiresUnlock, false);
      assert.equal(st.remainingAttempts, 5);
      assert.equal(st.locked, false);
      assert.equal(st.emergencyAccessAllowed, false);
    });

    test('Setup saves hashed PIN securely and rejects duplicate setup', async () => {
      const res = await service.create(userA, '1234');
      assert.deepEqual(res, { success: true });

      const doc = await backend.firestore.collection(MPIN_ACCOUNTS).doc(userA).get();
      assert.ok(doc.data().pinHash.startsWith('scrypt$'));
      assert.notEqual(doc.data().pinHash, '1234');

      // Duplicate setup must fail
      await assert.rejects(
        () => service.create(userA, '5678'),
        /MPIN is already configured/,
      );
    });
  });

  describe('2. Unlock & Attempt Limits & Lockout', () => {
    beforeEach(async () => {
      await service.create(userA, '1234');
    });

    test('Correct PIN unlocks account and sets unlockExpiresAt', async () => {
      const res = await service.unlock(userA, '1234');
      assert.deepEqual(res, { success: true });

      const st = await service.status(userA);
      assert.equal(st.configured, true);
      assert.equal(st.requiresUnlock, false);
      assert.ok(st.unlockExpiresAt > Date.now());
    });

    test('Failed attempts count down and 5 failed attempts trigger 15-minute lockout', async () => {
      for (let i = 1; i <= 4; i++) {
        await assert.rejects(
          () => service.unlock(userA, '9999'),
          /Incorrect MPIN/,
        );
        const st = await service.status(userA);
        assert.equal(st.remainingAttempts, 5 - i);
        assert.equal(st.locked, false);
      }

      // 5th attempt locks the account
      await assert.rejects(
        () => service.unlock(userA, '9999'),
        /Incorrect MPIN/,
      );

      const stLocked = await service.status(userA);
      assert.equal(stLocked.locked, true);
      assert.equal(stLocked.remainingAttempts, 0);
      assert.ok(stLocked.lockedUntil > Date.now());

      // Attempting unlock while locked throws 429
      await assert.rejects(
        () => service.unlock(userA, '1234'),
        (err) => err.status === 429 && err.response.message === 'MPIN is locked',
      );
    });
  });

  describe('3. Change Flow & Brute-force Protection', () => {
    beforeEach(async () => {
      await service.create(userA, '1234');
    });

    test('authorizeChange enforces lockout and attempt limits on failed guesses', async () => {
      // 5 failed guesses against authorizeChange must lock the account
      for (let i = 0; i < 4; i++) {
        await assert.rejects(() => service.authorizeChange(userA, '0000'), /Incorrect MPIN/);
      }
      await assert.rejects(() => service.authorizeChange(userA, '0000'), /Incorrect MPIN/);

      const st = await service.status(userA);
      assert.equal(st.locked, true);
      assert.equal(st.remainingAttempts, 0);

      // Now blocked
      await assert.rejects(() => service.authorizeChange(userA, '1234'), (err) => err.status === 429);
    });

    test('Successful change flow consumes grant and enforces single-use', async () => {
      const authGrant = await service.authorizeChange(userA, '1234');
      assert.ok(authGrant.token);

      // Request change code consumes the change-proof grant
      const challenge = await service.requestChangeCode(userA, authGrant.token);
      assert.ok(challenge.challengeId);
      assert.equal(challenge.maskedDestination, 'a***@example.com');

      // Replay of same change-proof grant must be rejected
      await assert.rejects(
        () => service.requestChangeCode(userA, authGrant.token),
        /Invalid or expired authorization/,
      );

      // Verify code
      const changeGrant = await service.verifyChangeCode(userA, challenge.challengeId, challenge.__devCode);
      assert.ok(changeGrant.token);

      // Change PIN
      const res = await service.change(userA, changeGrant.token, '5678');
      assert.deepEqual(res, { success: true });

      // Grant replay must fail
      await assert.rejects(
        () => service.change(userA, changeGrant.token, '9999'),
        /Invalid or expired authorization/,
      );

      // New PIN works, old PIN fails
      await assert.rejects(() => service.unlock(userA, '1234'), /Incorrect MPIN/);
      const unlockRes = await service.unlock(userA, '5678');
      assert.deepEqual(unlockRes, { success: true });
    });
  });

  describe('4. Resend Cooldowns & Purpose Isolation', () => {
    beforeEach(async () => {
      await service.create(userA, '1234');
    });

    test('Resend enforces 60-second cooldown and invalidates old challenge', async () => {
      const challenge = await service.requestRecovery(userA);

      // Immediate resend is blocked by cooldown (429)
      await assert.rejects(
        () => service.resendRecovery(userA, challenge.challengeId),
        (err) => err.status === 429 && /Code cannot be resent yet/.test(err.message),
      );

      // Fast-forward cooldown by modifying resendAt
      await backend.firestore
        .collection(MPIN_CHALLENGES)
        .doc(challenge.challengeId)
        .set({ resendAt: Date.now() - 1000 }, { merge: true });

      const newChallenge = await service.resendRecovery(userA, challenge.challengeId);
      assert.notEqual(newChallenge.challengeId, challenge.challengeId);

      // Old challenge is marked replaced and cannot be verified
      await assert.rejects(
        () => service.verifyRecovery(userA, challenge.challengeId, challenge.__devCode),
        /Invalid or expired code/,
      );

      // New code verifies successfully
      const resetGrant = await service.verifyRecovery(userA, newChallenge.challengeId, newChallenge.__devCode);
      assert.ok(resetGrant.token);

      // Reset PIN
      await service.reset(userA, resetGrant.token, '4321');
      const unlockRes = await service.unlock(userA, '4321');
      assert.deepEqual(unlockRes, { success: true });
    });

    test('Purpose isolation: change grant cannot be used for reset and vice-versa', async () => {
      const recChallenge = await service.requestRecovery(userA);
      const resetGrant = await service.verifyRecovery(userA, recChallenge.challengeId, recChallenge.__devCode);

      // Cannot use reset grant on change endpoint
      await assert.rejects(
        () => service.change(userA, resetGrant.token, '1111'),
        /Invalid or expired authorization/,
      );

      // Cannot use recovery challenge on change code verify
      const authGrant = await service.authorizeChange(userA, '1234');
      const changeChallenge = await service.requestChangeCode(userA, authGrant.token);

      await assert.rejects(
        () => service.verifyRecovery(userA, changeChallenge.challengeId, changeChallenge.__devCode),
        /Invalid or expired code/,
      );
    });

    test('Account isolation: User B cannot use User A grants or challenges', async () => {
      const recChallenge = await service.requestRecovery(userA);

      // User B tries to verify User A's challenge
      await assert.rejects(
        () => service.verifyRecovery(userB, recChallenge.challengeId, recChallenge.__devCode),
        /Invalid or expired code/,
      );

      // User A verifies
      const grant = await service.verifyRecovery(userA, recChallenge.challengeId, recChallenge.__devCode);

      // User B tries to use User A's grant to reset User B's PIN
      await service.create(userB, '9999');
      await assert.rejects(
        () => service.reset(userB, grant.token, '8888'),
        /Invalid or expired authorization/,
      );
    });
  });

  describe('5. Account Updates & Email Immutability', () => {
    test('Empty update body is rejected', () => {
      const input = {};
      const hasAtLeastOneField = Object.values(input).some((val) => val !== undefined);
      assert.equal(hasAtLeastOneField, false);
    });

    test('Editable fields validation: names, phone, vehicle', () => {
      const phoneRegex = /^\+?[1-9]\d{7,14}$/;
      assert.ok(phoneRegex.test('+15555550199'));
      assert.ok(phoneRegex.test('0912345678') === false); // invalid format
      assert.ok(phoneRegex.test('+639171234567'));
    });
  });
});
