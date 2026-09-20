import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ResponseMessage } from '@/common/decorators/response-message.decorator';
import { ProfileService } from '../profile/profile.service';
import { AuthService } from './auth.service';
import { TokenRequest } from 'ably';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly profileService: ProfileService,
    private readonly authService: AuthService,
  ) {}

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

  // route: GET /auth/is-old-user
  @Get('is-old-user')
  @ResponseMessage('User status retrieved successfully')
  getUserStatus(@Req() req: Request): Promise<boolean> {
    return this.profileService.findProfileByUid(req.user?.uid as string);
  }

  // route: GET /auth/ably-token
  @Get('ably-token')
  @ResponseMessage('Ably token request created successfully')
  async getAblyToken(@Req() req: Request): Promise<TokenRequest> {
    const userId = req.user?.uid as string;
    return this.authService.createAblyTokenRequest(userId);
  }
}
