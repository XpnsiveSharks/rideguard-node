# Throttler

This project uses `@nestjs/throttler` to rate-limit HTTP routes.

The throttler is registered globally in `src/app.module.ts` through
`APP_GUARD`, so every controller route is rate-limited by default. You only
need a decorator when a controller or route needs a different limit, or when a
route should be excluded from throttling.

## Default Limit

The global limit is configured with environment variables:

| Name | Default | Meaning |
| --- | --- | --- |
| `THROTTLE_TTL` | `60000` | Rate-limit window length in milliseconds. |
| `THROTTLE_LIMIT` | `100` | Max requests from one client IP within that window. |

With the defaults, one client IP can make `100` requests every `60000`
milliseconds.

The options are built in `src/infra/throttler/throttler.config.ts`:

```ts
throttlers: [
  {
    name: 'default',
    ttl: configService.get('THROTTLE_TTL', { infer: true }),
    limit: configService.get('THROTTLE_LIMIT', { infer: true }),
  },
],
errorMessage: 'Too many requests, please try again later.',
```

When the limit is exceeded, the API responds with HTTP `429`.

## Import

```ts
import { SkipThrottle, Throttle } from '@nestjs/throttler';
```

## Override A Single Route

Use `@Throttle()` on a controller handler when one route needs a stricter or
looser limit than the global default.

```ts
import { Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

@Controller('auth')
export class AuthController {
  @Post('send-code')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  sendCode() {
    return { sent: true };
  }
}
```

This allows one client IP to call `POST /auth/send-code` up to `5` times per
`60000` milliseconds.

## Override A Whole Controller

Place `@Throttle()` on the controller class when every route in that controller
should share the same limit.

```ts
import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

@Controller('rides')
@Throttle({ default: { limit: 200, ttl: 60000 } })
export class RidesController {
  @Get()
  findAll() {
    return [];
  }
}
```

If a route has its own `@Throttle()` decorator, the route-level limit should be
used for that route.

## Skip Throttling

Use `@SkipThrottle()` only for routes that must not be rate-limited, such as an
internal health check used by infrastructure.

```ts
import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

@Controller('health')
export class HealthController {
  @Get('firestore')
  @SkipThrottle()
  checkFirestore() {
    return { ok: true };
  }
}
```

`@Public()` only skips authentication. It does not skip throttling. If a public
route should not be rate-limited, add `@SkipThrottle()` as well.

## Common Patterns

Use stricter limits for endpoints that can send messages, create tokens, or
trigger external work:

```ts
@Post('login')
@Throttle({ default: { limit: 10, ttl: 60000 } })
login() {
  return this.authService.login();
}
```

Use looser limits for normal read-heavy endpoints:

```ts
@Get()
@Throttle({ default: { limit: 300, ttl: 60000 } })
findAll() {
  return this.ridesService.findAll();
}
```

Leave the decorator off when the global `THROTTLE_TTL` and `THROTTLE_LIMIT`
are already appropriate.
