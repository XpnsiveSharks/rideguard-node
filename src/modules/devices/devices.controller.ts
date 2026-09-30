import { Controller, UseGuards } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { Post, Body, Patch, Param, Req, Res } from '@nestjs/common';
import { DeviceRegistrationDto } from './devices.dto';
import type { Request, Response } from 'express';
import { Public } from '@/common/decorators/public.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { RolesGuard } from '@/common/guards/roles.guard';
import type { RegisterDeviceResult, RotateDeviceSecretResult } from './devices.types';

@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

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
