import { Controller, Header, Headers, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { Get, Post, Body, Patch, Param, Req, Res } from '@nestjs/common';
import { DeviceRegistrationDto } from './devices.dto';
import type { Request, Response } from 'express';
import { Public } from '@/common/decorators/public.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { RolesGuard } from '@/common/guards/roles.guard';
import { ServiceKeyGuard } from '@/common/guards/service-key.guard';
import type {
  DevicePublisherTokenResult,
  RegisterDeviceResult,
  RotateDeviceSecretResult,
} from './devices.types';
import { DeviceTokenService } from './device-token.service';

@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devicesService: DevicesService,
    private readonly deviceTokenService: DeviceTokenService,
  ) {}

  // Skips Firebase auth; DeviceTokenService verifies the hardware secret instead.
  @Public()
  @Post(':device_id/ably-token')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  getPublisherToken(
    @Param('device_id') deviceId: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<DevicePublisherTokenResult> {
    return this.deviceTokenService.issuePublisherToken(deviceId, authorization);
  }

  // ADMIN ROUTE
  // route: POST /devices
  @Roles('admin', 'manufacturing')
  @UseGuards(RolesGuard)
  @Post()
  async registerDevice(
    @Body()
    body: DeviceRegistrationDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RegisterDeviceResult> {
    const result = await this.devicesService.registerDevice(body.device_type);

    // This removes the secret from any shared cache.
    res.setHeader('Cache-Control', 'no-store');

    return result;
  }

  // MOBILE ROUTE
  // route: PATCH /devices/claim-device/:device_id
  @Patch('claim-device/:device_id')
  assignDeviceToUser(@Param('device_id') device_id: string, @Req() req: Request) {
    console.log(`Assigning device ${device_id} to user ${req.user?.uid}`);
    return this.devicesService.assignDeviceToUser(device_id, req.user?.uid);
  }

  // HARDWARE ROUTE
  // route: PATCH /devices/activate-device/:device_id
  @Public()
  @Patch('activate-device/:device_id')
  activateDevice(@Param('device_id') deviceId: string) {
    return this.devicesService.activateDevice(deviceId);
  }

  // SERVICE ROUTE (model-api)
  // route: GET /devices/:device_id/cameras
  // Resolves the cameras paired with a button for a START_CAPTURE. Returns an
  // empty list when the button has no owner or the owner has no camera.
  @Public()
  @UseGuards(ServiceKeyGuard)
  @Get(':device_id/cameras')
  async getPairedCameras(@Param('device_id') deviceId: string): Promise<{ camera_ids: string[] }> {
    const cameraIds = await this.devicesService.findPairedCameraIds(deviceId);

    return { camera_ids: cameraIds };
  }

  // HARDWARE ROUTE
  // route: POST /devices/button-event/:device_id/:button_event
  @Public()
  @Post('button-event/:device_id/:button_event')
  handleButtonEvent(
    @Param('device_id') deviceId: string,
    @Param('button_event') buttonEvent: string,
  ) {
    return this.devicesService.handleButtonEvent(deviceId, buttonEvent);
  }
  // ADMIN / MANUFACTURING ROUTE
  // route: Patch /devices/:device_id/rotate-secret
  @Roles('admin', 'manufacturing')
  @UseGuards(RolesGuard)
  @Patch(':device_id/rotate-secret')
  async rotateSecret(
    @Param('device_id') deviceId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RotateDeviceSecretResult> {
    const result = await this.devicesService.rotateDeviceSecret(deviceId);

    // The secret is a one-time credential; keep it out of any shared cache.
    res.setHeader('Cache-Control', 'no-store');

    return result;
  }
}
