import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ResponseMessage } from '@/common/decorators/response-message.decorator';
import { ProfileService } from '../profile/profile.service';
import { AuthService } from './auth.service';
import { TokenRequest } from 'ably';
import { Public } from '@/common/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';
import { ForgotPasswordDto, LoginDto, RegisterDto } from './auth.dto';

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

  // POST /auth/register; JSON username, email, password.
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  // POST /auth/register/verify; Authorization: Bearer <verified Firebase ID token>.
  @Public()
  @Post('register/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verifyRegistration(@Req() req: Request) {
    return this.authService.verifyRegistration(req.headers.authorization);
  }

  // POST /auth/login; JSON identifier and password.
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  // POST /auth/forgot-password; JSON email.
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.forgotPassword(body);
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
