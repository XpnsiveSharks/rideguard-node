import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ResponseMessage } from '@/common/decorators/response-message.decorator';
import { ProfileService } from '../profile/profile.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly profileService: ProfileService) {}

  // route: GET /auth/me
  @Get('me')
  @ResponseMessage('User profile retrieved successfully')
  getMe(@Req() req: Request) {
    return {
      uid: req.user?.uid,
      email: req.user?.email,
      emailVerified: req.user?.email_verified,
      name: req.user?.name as string | undefined,
      picture: req.user?.picture,
    };
  }
  // route: GET /auth/is-new-user
  @Get('is-new-user')
  getUserStatus(@Req() req: Request) {
    return this.profileService.findProfileByUid(req.user?.uid as string);
  }
}
