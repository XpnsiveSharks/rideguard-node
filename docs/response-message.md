# Response Messages

Successful controller responses are wrapped by `ResponseInterceptor` into a
standard response envelope:

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {}
}
```

Use `@ResponseMessage()` when a route should return a more specific success
message.

## Import

```ts
import { ResponseMessage } from '@/common/decorators/response-message.decorator';
```

## Route Usage

Place `@ResponseMessage()` on the controller handler:

```ts
import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ResponseMessage } from '@/common/decorators/response-message.decorator';

@Controller('auth')
export class AuthController {
  @Get('me')
  @ResponseMessage('User profile retrieved successfully')
  getMe(@Req() req: Request) {
    return {
      uid: req.user?.uid,
      email: req.user?.email,
    };
  }
}
```

Handlers should return only the data payload. Do not manually return `success`,
`message`, or `data` from a controller handler; the global interceptor adds
those fields to the HTTP response.

The response becomes:

```json
{
  "success": true,
  "message": "User profile retrieved successfully",
  "data": {
    "uid": "firebase-user-id",
    "email": "user@example.com"
  }
}
```

## Handler DTOs

Controller handler DTOs should describe the value inside `data`, not the full
response envelope.

For example:

```ts
type GetMeResponseDto = {
  uid?: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  picture?: string;
};

@Get('me')
@ResponseMessage('User profile retrieved successfully')
getMe(@Req() req: Request): GetMeResponseDto {
  return {
    uid: req.user?.uid,
    email: req.user?.email,
    emailVerified: req.user?.email_verified,
    name: req.user?.name as string | undefined,
    picture: req.user?.picture,
  };
}
```

The client still receives the standard envelope:

```ts
StandardResponse<GetMeResponseDto>
```

That wrapping happens automatically in `ResponseInterceptor`.

## Controller Usage

You can also place `@ResponseMessage()` on a controller class when every route
in that controller should share the same message:

```ts
import { Controller, Get } from '@nestjs/common';
import { ResponseMessage } from '@/common/decorators/response-message.decorator';

@Controller('health')
@ResponseMessage('Health check completed successfully')
export class HealthController {
  @Get()
  check() {
    return { ok: true };
  }
}
```

If both the controller and the route have `@ResponseMessage()`, the route-level
message wins.

## Default Behavior

If a route does not use `@ResponseMessage()`, the interceptor uses:

```text
Request completed successfully
```

For example:

```ts
@Get('settings')
getSettings() {
  return { theme: 'dark' };
}
```

returns:

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {
    "theme": "dark"
  }
}
```

## Empty Responses

If a handler returns `undefined` or `null`, the interceptor converts `data` to
an empty object:

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {}
}
```

## Errors

`ResponseMessage` only affects successful responses. Exceptions are handled by
`HttpExceptionFilter`, which returns the error envelope:

```json
{
  "success": false,
  "message": "Resource not found",
  "statusCode": 404
}
```

## When To Use It

Use `@ResponseMessage()` when the default message is too generic for the client
or for API logs:

- `@ResponseMessage('User profile retrieved successfully')`
- `@ResponseMessage('Ride created successfully')`
- `@ResponseMessage('Emergency contact updated successfully')`

Keep messages short, specific, and written from the API's point of view.
