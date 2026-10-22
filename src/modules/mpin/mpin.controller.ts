import { BadRequestException, Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { MpinService } from './mpin.service';
import {
  MpinAuthorizationDto,
  MpinChallengeDto,
  MpinChangeCodeRequestDto,
  MpinCurrentPinDto,
  MpinPinDto,
  MpinStatusContextDto,
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
  status(@Req() req: Request, @Query() query?: MpinStatusContextDto) {
    return this.service.status(this.uid(req), query);
  }

  @Post('setup')
  setup(@Req() req: Request, @Body() b: MpinPinDto) {
    return this.service.create(this.uid(req), b.pin);
  }

  @Post('unlock')
  unlock(@Req() req: Request, @Body() b: MpinPinDto) {
    return this.service.unlock(this.uid(req), b.pin);
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

  @Post('recovery/reset')
  reset(@Req() req: Request, @Body() b: MpinAuthorizationDto) {
    return this.service.reset(this.uid(req), b.authorization, b.pin);
  }
}
