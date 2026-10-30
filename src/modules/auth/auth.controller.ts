import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ResponseMessage } from '@/common/decorators/response-message.decorator';
import { ProfileService } from '../profile/profile.service';
import { AuthService } from './auth.service';
import { TokenRequest } from 'ably';
import { Public } from '@/common/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';
import {
  ChangePasswordDto,
  DeleteAccountDto,
  EnrollPhoneKeyDto,
  ForgotPasswordDto,
  LoginDto,
  PhoneAuthChallengeDto,
  RegisterDto,
  ResendVerificationCodeDto,
  RevokePhoneKeyDto,
  UpdateOnboardingDto,
  VerifyEmailCodeDto,
  VerifyPhoneSignatureDto,
} from './auth.dto';
import { AllowDuringDeletion } from './account-deletion.decorator';

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

  // POST /auth/verification/verify; JSON email + 6-digit code (public — code is the auth factor).
  @Public()
  @Post('verification/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ResponseMessage('Email verified successfully')
  verifyEmailCode(@Body() body: VerifyEmailCodeDto) {
    return this.authService.verifyEmailCode(body);
  }

  // POST /auth/verification/resend; JSON email. Server-side cooldown + throttler.
  @Public()
  @Post('verification/resend')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ResponseMessage('Verification code sent')
  resendVerificationCode(@Body() body: ResendVerificationCodeDto) {
    return this.authService.resendVerificationCode(body);
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

  // POST /auth/change-password; JSON currentPassword + newPassword (authenticated).
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ResponseMessage('Password changed successfully')
  changePassword(@Req() req: Request, @Body() body: ChangePasswordDto) {
    const userId = req.user?.uid as string;
    return this.authService.changePassword(userId, body);
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

  // POST /auth/delete-account
  @Post('delete-account')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ResponseMessage('Account deletion scheduled successfully')
  requestDeleteAccount(@Req() req: Request, @Body() body: DeleteAccountDto) {
    const userId = req.user?.uid as string;
    return this.authService.requestAccountDeletion(userId, body.password);
  }

  // POST /auth/delete-account/cancel
  @Post('delete-account/cancel')
  @HttpCode(HttpStatus.OK)
  @AllowDuringDeletion()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ResponseMessage('Account deletion cancelled successfully')
  cancelDeleteAccount(@Req() req: Request) {
    const userId = req.user?.uid as string;
    return this.authService.cancelAccountDeletion(userId);
  }

  // GET /auth/delete-account/status
  @Get('delete-account/status')
  @AllowDuringDeletion()
  @ResponseMessage('Account deletion status retrieved successfully')
  getDeleteAccountStatus(@Req() req: Request) {
    const userId = req.user?.uid as string;
    return this.authService.getDeletionStatus(userId);
  }

  // GET /auth/onboarding
  @Get('onboarding')
  @ResponseMessage('Onboarding progress retrieved successfully')
  getOnboarding(@Req() req: Request) {
    const userId = req.user?.uid as string;
    return this.authService.getOnboarding(userId);
  }

  // PATCH /auth/onboarding
  @Patch('onboarding')
  @ResponseMessage('Onboarding progress updated successfully')
  updateOnboarding(@Req() req: Request, @Body() body: UpdateOnboardingDto) {
    const userId = req.user?.uid as string;
    return this.authService.updateOnboarding(userId, body);
  }

  // POST /auth/onboarding/complete
  @Post('onboarding/complete')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Onboarding completed successfully')
  completeOnboarding(@Req() req: Request) {
    const userId = req.user?.uid as string;
    return this.authService.completeOnboarding(userId);
  }

  // POST /auth/phone/enroll-key
  @Post('phone/enroll-key')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Phone authentication key enrolled successfully')
  enrollPhoneKey(@Req() req: Request, @Body() body: EnrollPhoneKeyDto) {
    const userId = req.user?.uid as string;
    return this.authService.enrollPhoneKey(userId, body);
  }

  // POST /auth/phone/challenge
  @Public()
  @Post('phone/challenge')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ResponseMessage('Phone authentication challenge issued successfully')
  issuePhoneChallenge(@Body() body: PhoneAuthChallengeDto) {
    return this.authService.issuePhoneChallenge(body);
  }

  // POST /auth/phone/verify-signature
  @Public()
  @Post('phone/verify-signature')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ResponseMessage('Phone signature verified successfully')
  verifyPhoneSignature(@Body() body: VerifyPhoneSignatureDto) {
    return this.authService.verifyPhoneSignature(body);
  }

  // POST /auth/phone/revoke-key
  @Post('phone/revoke-key')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Phone authentication key revoked successfully')
  revokePhoneKey(@Req() req: Request, @Body() body: RevokePhoneKeyDto) {
    const userId = req.user?.uid as string;
    return this.authService.revokePhoneKey(userId, body);
  }

  // POST /auth/logout
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Logged out successfully')
  logout(@Req() req: Request, @Headers('x-device-id') deviceId?: string) {
    const userId = req.user?.uid as string;
    return this.authService.logout(userId, deviceId);
  }
}
