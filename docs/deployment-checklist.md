# Before pushing backend changes

For collaborators and their AI assistants. Read this before changing backend code or tests.

## 1. Update affected tests

When changing a shared guard or service, search for its callers and test mocks.
Add any newly required methods to those mocks. Keep tests for authentication,
ownership, and validation; do not change expected errors to HTTP 500.

Example: `FirebaseAuthGuard` calls `AuthService.isDeletionScheduled(uid)`.
The SOS HTTP tests mocked `verifyToken()` but omitted `isDeletionScheduled()`.
Authenticated requests threw before reaching the controllers. Three tests
returned HTTP 500 and blocked deployment.

The test fix was:

```ts
isDeletionScheduled: jest.fn().mockResolvedValue(false),
```

That value represents an account without a scheduled deletion. Keep separate
tests for accounts whose deletion is scheduled. Do not remove the guard check.

Prefer typed mocks so TypeScript can catch missing methods:

```ts
const auth = {
  verifyToken: jest.fn(),
  isDeletionScheduled: jest.fn().mockResolvedValue(false),
} satisfies Pick<AuthService, 'verifyToken' | 'isDeletionScheduled'>;
```

Configure `verifyToken` for each test. Avoid broad casts such as
`as unknown as AuthService`, which can hide missing methods.

## 2. Run checks before pushing

Use Node.js **22.x**, matching `package.json` and GitHub Actions.
Run from the Node repository root:

```sh
npm ci
npm test -- --runInBand
npm run build
```

In Windows PowerShell, use `npm.cmd` if `npm` is blocked by script policy.
All three commands must succeed. Record the results in the PR or handoff.
For documentation-only changes, check links and `git diff --check` instead.

## 3. Read the failure summary

Start with `FAIL`, the test name, expected versus actual results, and the final
summary. An `ERROR` log alone does not mean the test failed.

The SMS adapter tests deliberately simulate missing keys, HTTP 401/403,
timeouts, and server failures. Those logs are expected when those tests pass.
Check real runtime credential errors separately.

The SOS failures above used an in-memory repository. Deleting Firestore data
did not cause them. Do not restore data or change credentials to fix a mock.

## 4. Check CI before deploying

Push the fix and confirm GitHub Actions passes for that commit before merging
or deploying. Do not disable tests or bypass failed checks.

Local checks cannot guarantee CI will pass. Passing CI also does not verify
production credentials, database contents, or real SMS delivery.
