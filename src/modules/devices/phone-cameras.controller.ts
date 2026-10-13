import {
  Body,
  Controller,
  Delete,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '@/common/decorators/public.decorator';
import { ServiceKeyGuard } from '@/common/guards/service-key.guard';
import {
  PhonePresenceDto,
  RegisterPhoneCameraDto,
  StartPhoneSessionDto,
  VerifyPhoneUploadDto,
} from './devices.dto';
import { PhoneCameraService } from './phone-camera.service';
import type { PhoneCameraView, PhoneSessionView, VerifiedPhoneUpload } from './devices.types';

@Controller('devices/phone')
export class PhoneCamerasController {
  constructor(private readonly phoneCameraService: PhoneCameraService) {}

  // MOBILE ROUTE
  // route: POST /devices/phone
  // Creates or returns this installation's phone camera.
  @Post()
  @HttpCode(HttpStatus.OK)
  registerPhoneCamera(
    @Body() body: RegisterPhoneCameraDto,
    @Req() req: Request,
  ): Promise<PhoneCameraView> {
    return this.phoneCameraService.registerPhoneCamera(req.user?.uid, body.installation_id);
  }

  // MOBILE ROUTE
  // route: POST /devices/phone/:device_id/sessions
  // Starts an upload session and returns a one-time upload token.
  @Post(':device_id/sessions')
  @Header('Cache-Control', 'no-store')
  startSession(
    @Param('device_id') deviceId: string,
    @Body() body: StartPhoneSessionDto,
    @Req() req: Request,
  ): Promise<PhoneSessionView> {
    return this.phoneCameraService.startSession(req.user?.uid, deviceId, body.duration_ms);
  }

  // MOBILE ROUTE
  // route: DELETE /devices/phone/:device_id/sessions/:session_id
  @Delete(':device_id/sessions/:session_id')
  @HttpCode(HttpStatus.NO_CONTENT)
  endSession(
    @Param('device_id') deviceId: string,
    @Param('session_id') sessionId: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.phoneCameraService.endSession(req.user?.uid, deviceId, sessionId);
  }

  // SERVICE ROUTE (model-api)
  // route: POST /devices/phone/sessions/verify
  // The token is in the body, not the URL, so it stays out of access logs.
  @Public()
  @SkipThrottle()
  @UseGuards(ServiceKeyGuard)
  @Post('sessions/verify')
  @HttpCode(HttpStatus.OK)
  verifyUpload(@Body() body: VerifyPhoneUploadDto): Promise<VerifiedPhoneUpload> {
    return this.phoneCameraService.verifyUploadToken(body.upload_token);
  }

  // SERVICE ROUTE (model-api)
  // route: POST /devices/phone/sessions/:session_id/presence
  @Public()
  @SkipThrottle()
  @UseGuards(ServiceKeyGuard)
  @Post('sessions/:session_id/presence')
  @HttpCode(HttpStatus.NO_CONTENT)
  reportPresence(
    @Param('session_id') sessionId: string,
    @Body() body: PhonePresenceDto,
  ): Promise<void> {
    return this.phoneCameraService.reportPresence(sessionId, body.connected);
  }
}
