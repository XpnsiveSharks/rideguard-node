# Ably

[Ably](https://ably.com) is the realtime messaging service RideGuard publishes
to. This page covers the shared client every backend service uses, how its
credential is configured, and how to confirm the integration works.

## What Is Set Up

| Piece | Where |
| --- | --- |
| SDK | `ably` (official Node/TS SDK), a runtime dependency |
| Shared client | `src/infra/ably/ably.provider.ts` |
| DI token | `ABLY_REST` in `src/infra/ably/ably.constants.ts` |
| Module | `AblyModule`, global, registered in `app.module.ts` |
| Credential | `ABLY_API_KEY`, validated at startup |
| Connectivity check | `GET /v1/health/ably` |

## Using The Shared Client

`AblyModule` is `@Global()`, so any service can inject the client without
importing the module. Inject the `ABLY_REST` token:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Rest } from 'ably';
import { ABLY_REST } from '@/infra/ably/ably.constants';

@Injectable()
export class RidesService {
  constructor(@Inject(ABLY_REST) private readonly ably: Rest) {}

  async publishRideUpdate(rideId: string, payload: unknown) {
    await this.ably.channels.get(`rides:${rideId}`).publish('ride.updated', payload);
  }
}
```

Import the token from `ably.constants.ts`, not from `ably.module.ts`. The
constants file has no runtime dependencies, so importing it does not pull the
SDK into the consumer - the same reason `firebase.constants.ts` exists.

## Why REST And Not Realtime

The SDK ships two clients. This module provides `Ably.Rest`:

| | `Rest` | `Realtime` |
| --- | --- | --- |
| Transport | HTTP per call | Persistent WebSocket |
| Good for | Publishing from a backend | Subscribing, presence |
| Lifecycle | Stateless, nothing to open or close | Connection state to manage |

The backend publishes; the mobile and admin clients subscribe. A stateless
client is also the right shape for App Service, where instances are recycled
and a long-lived socket per instance would have to be torn down on shutdown.

If a service later needs to *subscribe* from the backend, add a second token
(`ABLY_REALTIME`) and provider beside this one rather than swapping this one
out - `ably.constants.ts` is written to hold one token per SDK surface. A
realtime client does need `close()` wiring in `onModuleDestroy`.

## Configuration

One variable, `ABLY_API_KEY`, in the format `appId.keyId:keySecret`. Copy it
from the Ably dashboard under your app's **API keys**.

It is `required()` in `envValidationSchema` and shape-checked, so a missing,
truncated, or half-pasted key fails at startup with a message naming the
variable instead of surfacing as a 401 on the first publish:

```
Config validation error: ABLY_API_KEY must look like appId.keyId:keySecret
```

See [Environment variables](environment.md) for the local `.env` setup and
[Secrets in deployment](environment.md#secrets-in-deployment) for how the key
reaches deployed environments.

### Key Capabilities

A valid key is not automatically a key that can do what your service needs.
Every Ably key carries a capability - a map of channel to allowed operations -
set on the key in the dashboard, not in this codebase. A key scoped to
`{"some-channel": ["subscribe"]}` authenticates fine and passes the health
check, then fails the first publish with:

```
Unauthorized to publish to channel
```

If a publish fails that way, the key is valid and the capability is wrong.
Check it in the Ably dashboard, or from a REPL:

```ts
const { capability } = await ably.auth.requestToken();
```

A backend key that publishes needs `publish` on the channels it writes to.

## Keeping The Key Out Of Logs

Two things guard this, and both matter when changing this module:

- The client is pinned to Ably's **errors-only** log level. Above that the SDK
  writes its internal HTTP activity straight to `console.log`, bypassing pino.
- The provider does not interpolate the SDK's error text when construction
  fails, since that is the one string that could carry the key. It raises its
  own message naming the variable instead.

Never log `configService.get('ABLY_API_KEY')`, and never put a real key in
`.env.example`, a doc, a test, or a workflow file.

## Confirming It Works

The health route asks Ably to issue a token for the configured key. It is
`@Public()`, so no auth token of our own is needed:

```bash
curl http://localhost:5565/v1/health/ably
```

```json
{
  "success": true,
  "message": "Ably connection is healthy",
  "data": { "ok": true },
  "timestamp": "2026-09-11T01:20:00.000Z"
}
```

A token request is an authenticated round trip, so a `200` proves both that the
app can reach Ably and that `ABLY_API_KEY` is accepted. Two alternatives were
rejected:

- **Publishing to a test channel** proves the same thing, but only for a key
  whose capability allows publishing on whichever channel the check picked. Ably
  keys are commonly scoped to one channel and one operation - a subscribe-only
  key is a perfectly valid key that would fail this check with
  `Unauthorized to publish to channel`. The check would then be reporting the
  key's capability, not the integration's health.
- **`client.time()`** hits a public endpoint that needs no credential at all, so
  it would pass with a completely wrong key.

The token the check receives is itself a credential. It is discarded, never
returned in the response or logged.

A failure returns 500 with the reason, most often a key that is well-formed but
not valid for the target app:

```json
{
  "success": false,
  "message": "Ably connectivity check failed: invalid key in request",
  "statusCode": 500,
  "timestamp": "2026-09-11T01:20:00.000Z"
}
```

## Tests

The specs are offline - they never reach the network, so CI runs them with no
Ably credential present:

```bash
yarn test ably.provider    # client construction, log level, failure messages
yarn test health.service   # the connectivity check, against a fake client
```

## Not Covered Here

Channel naming, event schemas, frontend subscriptions, presence, history, and
push notifications are all product decisions and are not part of this
infrastructure setup.
