import { Controller } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { Post, Body, Patch, Param, Req } from '@nestjs/common';
import { DeviceRegistrationDto } from './devices.dto';
import type { Request } from 'express';

@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  // route: POST /devices/register-device
  @Post('register-device')
  registerDevice(
    @Body()
    body: DeviceRegistrationDto,
  ) {
    return this.devicesService.registerDevice({
      deviceType: body.device_type,
    });
  }

  // route: PATCH /devices/assign-device/:device_id
  @Patch('assign-device/:device_id')
  assignDeviceToUser(@Param('device_id') deviceId: string, @Req() req: Request) {
    return this.devicesService.assignDeviceToUser(deviceId, req.user?.uid);
  }
}
