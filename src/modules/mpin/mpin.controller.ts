import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { MpinService } from './mpin.service';
import {
  MpinAuthorizationDto,
  MpinChallengeDto,
  MpinChangeCodeRequestDto,
  MpinCurrentPinDto,
  MpinEmailLinkChangeDto,
  MpinEmailLinkRequestDto,
  MpinPinDto,
  MpinStatusContextDto,
  MpinUnlockDto,
  MpinVerifyCodeDto,
} from './mpin.dto';

@Controller('mpin')
export class MpinController {
  constructor(private readonly service: MpinService) {}

  private uid(req: Request) {
    if (!req.user?.uid) throw new Error('Missing authenticated user');
    return req.user.uid;
  }

  @Get('status')
  status(
    @Req() req: Request,
    @Query() query?: MpinStatusContextDto,
    @Headers('x-device-id') deviceId?: string,
  ) {
    return this.service.status(this.uid(req), query, deviceId);
  }

  @Post('setup')
  setup(@Req() req: Request, @Body() b: MpinPinDto) {
    return this.service.create(this.uid(req), b.pin);
  }

  @Post('unlock')
  unlock(
    @Req() req: Request,
    @Body() b: MpinUnlockDto,
    @Headers('x-device-id') headerDeviceId?: string,
  ) {
    return this.service.unlock(this.uid(req), b.pin, b.deviceId || headerDeviceId);
  }

  @Post('lock')
  @HttpCode(HttpStatus.OK)
  lock(@Req() req: Request, @Headers('x-device-id') deviceId?: string) {
    return this.service.revokeDeviceUnlock(this.uid(req), deviceId).then(() => ({ success: true as const }));
  }

  @Post('change/authorize')
  authorize(@Req() req: Request, @Body() b: MpinCurrentPinDto) {
    return this.service.authorizeChange(this.uid(req), b.pin);
  }

  @Post('change/code')
  requestChange(@Req() req: Request, @Body() b: MpinChangeCodeRequestDto) {
    const token = b.authorization || b.currentPinProof;
    if (!token) {
      throw new BadRequestException('Authorization proof token is required');
    }
    return this.service.requestChangeCode(this.uid(req), token);
  }

  @Post('change/code/resend')
  resendChange(@Req() req: Request, @Body() b: MpinChallengeDto) {
    return this.service.resendChangeCode(this.uid(req), b.challengeId);
  }

  @Post('change/code/verify')
  verifyChange(@Req() req: Request, @Body() b: MpinVerifyCodeDto) {
    return this.service.verifyChangeCode(this.uid(req), b.challengeId, b.code);
  }

  @Post('change/email-link')
  requestChangeEmailLink(
    @Req() req: Request,
    @Body() b: MpinEmailLinkRequestDto,
    @Headers('x-device-id') headerDeviceId?: string,
  ) {
    return this.service.requestChangeEmailLink(
      this.uid(req),
      b.authorization,
      b.deviceId || headerDeviceId,
    );
  }

  @Post('change')
  change(@Req() req: Request, @Body() b: MpinAuthorizationDto) {
    return this.service.change(this.uid(req), b.authorization, b.pin);
  }

  @Post('recovery/code')
  requestRecovery(@Req() req: Request) {
    return this.service.requestRecovery(this.uid(req));
  }

  @Post('recovery/code/resend')
  resendRecovery(@Req() req: Request, @Body() b: MpinChallengeDto) {
    return this.service.resendRecovery(this.uid(req), b.challengeId);
  }

  @Post('recovery/code/verify')
  verifyRecovery(@Req() req: Request, @Body() b: MpinVerifyCodeDto) {
    return this.service.verifyRecovery(this.uid(req), b.challengeId, b.code);
  }

  @Post('recovery/email-link')
  requestRecoveryEmailLink(
    @Req() req: Request,
    @Body() b: MpinEmailLinkRequestDto,
    @Headers('x-device-id') headerDeviceId?: string,
  ) {
    return this.service.requestRecoveryEmailLink(this.uid(req), b.deviceId || headerDeviceId);
  }

  @Post('recovery/reset')
  reset(@Req() req: Request, @Body() b: MpinAuthorizationDto) {
    return this.service.reset(this.uid(req), b.authorization, b.pin);
  }

  @Post('email-link/verify-and-change')
  verifyEmailLinkAndChange(@Req() req: Request, @Body() b: MpinEmailLinkChangeDto) {
    return this.service.verifyEmailLinkAndChange(this.uid(req), b.token, b.pin);
  }
}
