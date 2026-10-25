import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

/**
 * Redacts a sensitive string by showing only first 6 and last 4 characters.
 */
function redact(val?: string | null): string {
  if (!val) return '[EMPTY]';
  if (val.length <= 12) return '[REDACTED]';
  return `${val.slice(0, 6)}...[REDACTED]...${val.slice(-4)}`;
}

/**
 * Masks an email address for logging.
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '[INVALID_EMAIL]';
  const visible = local.length > 2 ? local.slice(0, 2) : local.slice(0, 1);
  return `${visible}***@${domain}`;
}

interface CliOptions {
  email?: string;
  password?: string;
  markVerified: boolean;
  applyLink: boolean;
  createIfMissing: boolean;
  outFile: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    email: process.env.TEST_USER_EMAIL,
    password: process.env.TEST_USER_PASSWORD,
    markVerified: process.env.MARK_VERIFIED === 'true',
    applyLink: process.env.APPLY_VERIFICATION_LINK === 'true',
    createIfMissing: process.env.CREATE_TEST_USER_IF_MISSING === 'true',
    outFile: process.env.TOKEN_OUT_FILE || path.join(process.cwd(), '.tmp', 'firebase-id-token.txt'),
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--email' && args[i + 1]) {
      options.email = args[++i];
    } else if (arg === '--password' && args[i + 1]) {
      options.password = args[++i];
    } else if (arg === '--mark-verified') {
      options.markVerified = true;
    } else if (arg === '--apply-link') {
      options.applyLink = true;
    } else if (arg === '--create-if-missing') {
      options.createIfMissing = true;
    } else if (arg === '--out' && args[i + 1]) {
      options.outFile = args[++i];
    }
  }

  return options;
}

async function main() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  if (nodeEnv === 'production') {
    console.error('[ERROR] This development utility cannot be run in production (NODE_ENV=production).');
    process.exit(1);
  }

  const options = parseArgs();

  if (!options.email || !options.password) {
    console.error(
      '[ERROR] Missing credentials. Please provide TEST_USER_EMAIL and TEST_USER_PASSWORD via environment variables or CLI flags (--email, --password).',
    );
    process.exit(1);
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  const authBaseUrl = process.env.FIREBASE_AUTH_API_BASE_URL || 'https://identitytoolkit.googleapis.com/v1';

  if (!projectId || !clientEmail || !privateKey || !apiKey) {
    console.error(
      '[ERROR] Missing Firebase configuration. Ensure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, and FIREBASE_WEB_API_KEY are set.',
    );
    process.exit(1);
  }

  // Initialize Firebase Admin SDK
  const app =
    getApps()[0] ??
    initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
  const auth = getAuth(app);

  console.log(`[INFO] Authenticating test user: ${maskEmail(options.email)}`);

  // Check if user exists in Firebase Admin
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(options.email);
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error.code === 'auth/user-not-found') {
      if (options.createIfMissing) {
        console.log('[INFO] Test user does not exist. Creating dedicated test account...');
        userRecord = await auth.createUser({
          email: options.email,
          password: options.password,
          emailVerified: false,
        });
        console.log(`[INFO] Created test account (uid: ${userRecord.uid}, emailVerified: false).`);
      } else {
        console.error(
          `[ERROR] User ${maskEmail(options.email)} does not exist in Firebase. Pass --create-if-missing to create it.`,
        );
        process.exit(1);
      }
    } else {
      throw err;
    }
  }

  // Authenticate user via Firebase Auth REST API (signInWithPassword)
  const signInUrl = `${authBaseUrl}/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`;
  const signInRes = await fetch(signInUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: options.email,
      password: options.password,
      returnSecureToken: true,
    }),
  });

  if (!signInRes.ok) {
    const errBody = (await signInRes.json().catch(() => ({}))) as { error?: { message?: string } };
    console.error(`[ERROR] Authentication failed: ${errBody?.error?.message || signInRes.statusText}`);
    process.exit(1);
  }

  const signInData = (await signInRes.json()) as {
    idToken: string;
    refreshToken: string;
    localId: string;
  };

  let idToken = signInData.idToken;
  const refreshToken = signInData.refreshToken;
  const uid = signInData.localId;

  // Inspect current token claims
  const initialDecoded = await auth.verifyIdToken(idToken);
  userRecord = await auth.getUser(uid);

  console.log(`[INFO] User UID: ${uid}`);
  console.log(`[INFO] Account emailVerified in Firebase: ${userRecord.emailVerified}`);
  console.log(`[INFO] Current token email_verified claim: ${initialDecoded.email_verified}`);

  // Handle unverified account
  if (!userRecord.emailVerified) {
    console.log('[WARN] User email is not verified.');

    if (options.markVerified) {
      // Explicit development-only Admin SDK verification option (Requirement 3)
      const isTestEmail =
        options.email.includes('test') ||
        options.email.includes('dev') ||
        options.email.endsWith('.local') ||
        options.email.endsWith('.test');

      if (!isTestEmail) {
        console.error(
          '[SECURITY ERROR] --mark-verified can only be used on dedicated test accounts (email must contain "test", "dev", ".local", or ".test").',
        );
        process.exit(1);
      }

      console.log('[DEV OPTION] Marking dedicated test account as verified via Firebase Admin SDK...');
      userRecord = await auth.updateUser(uid, { emailVerified: true });
      console.log(`[SUCCESS] Firebase reports emailVerified: ${userRecord.emailVerified}`);
    } else {
      // Firebase's supported verification flow: generate email verification link
      console.log('[INFO] Generating Firebase email verification link...');
      const actionLink = await auth.generateEmailVerificationLink(options.email);

      if (options.applyLink) {
        // Supported flow: complete verification using the generated action link oobCode
        const parsedUrl = new URL(actionLink);
        const oobCode = parsedUrl.searchParams.get('oobCode');
        if (!oobCode) {
          console.error('[ERROR] Could not extract oobCode from action link.');
          process.exit(1);
        }

        const applyRes = await fetch(`${authBaseUrl}/accounts:update?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oobCode }),
        });

        if (!applyRes.ok) {
          console.error('[ERROR] Failed to apply email verification code.');
          process.exit(1);
        }

        userRecord = await auth.getUser(uid);
        console.log(`[SUCCESS] Verification completed via oobCode. Firebase emailVerified: ${userRecord.emailVerified}`);
      } else {
        console.log('\n------------------------------------------------------------');
        console.log('Firebase verification link:');
        console.log(actionLink);
        console.log('------------------------------------------------------------');
        console.log('Action required: Open the link above in a browser to complete verification,');
        console.log('or re-run this script with --apply-link or --mark-verified.');
        console.log('------------------------------------------------------------\n');
        process.exit(0);
      }
    }
  }

  // Refresh token: Obtain a FRESH Firebase ID token after verification (forcing refresh)
  console.log('[INFO] Forcing token refresh to obtain ID token with updated claims...');
  const secureTokenUrl = `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`;
  const refreshRes = await fetch(secureTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!refreshRes.ok) {
    console.error('[ERROR] Failed to refresh Firebase token.');
    process.exit(1);
  }

  const refreshData = (await refreshRes.json()) as { id_token: string };
  idToken = refreshData.id_token;

  // Verify resulting token with Firebase Admin SDK
  console.log('[INFO] Verifying fresh ID token with Firebase Admin SDK...');
  const verifiedToken = await auth.verifyIdToken(idToken, true);

  if (verifiedToken.email_verified !== true) {
    console.error(`[ERROR] Decoded email_verified claim is still ${verifiedToken.email_verified}.`);
    process.exit(1);
  }

  console.log(`[SUCCESS] Decoded email_verified claim: ${verifiedToken.email_verified}`);
  console.log(`[SUCCESS] Token UID: ${verifiedToken.uid}`);
  console.log(`[INFO] Token preview: ${redact(idToken)}`);

  // Write token to output file
  const outDir = path.dirname(options.outFile);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(options.outFile, idToken.trim(), 'utf8');
  console.log(`[SUCCESS] Full valid ID token saved to: ${options.outFile}`);
}

main().catch((err) => {
  console.error('[UNHANDLED ERROR]', err);
  process.exit(1);
});
