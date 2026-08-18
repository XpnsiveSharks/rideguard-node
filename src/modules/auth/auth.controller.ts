import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ResponseMessage } from '@/common/decorators/response-message.decorator';

@Controller('auth')
export class AuthController {
  // route: GET /auth/me
  @Get('me')
  @ResponseMessage('User profile retrieved successfully')
  getMe(@Req() req: Request) {
    return {
      uid: req.user?.uid,
      email: req.user?.email,
      emailVerified: req.user?.email_verified,
      // `name` is not a declared field on DecodedIdToken — it arrives via the
      // provider claims index signature, so it needs an explicit type.
      name: req.user?.name as string | undefined,
      picture: req.user?.picture,
    };
  }
}
