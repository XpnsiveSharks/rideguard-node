import { Controller } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { Post, Body, Patch, Param, Req } from '@nestjs/common';
import { DeviceRegistrationDto } from './devices.dto';
import type { Request } from 'express';
import { Public } from '@/common/decorators/public.decorator';

@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  // ADMIN ROUTE
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

  // MOBILE ROUTE
  // route: PATCH /devices/claim-device/:device_id
  @Patch('claim-device/:device_id')
  assignDeviceToUser(@Param('device_id') deviceId: string, @Req() req: Request) {
    return this.devicesService.assignDeviceToUser(deviceId, req.user?.uid);
  }

  // HARDWARE ROUTE
  // route: PATCH /devices/activate-device/:device_id
  // 400 - Bad Request: Invalid device ID format or missing required fields.
  // 404 - Not Found: Device with the specified ID does not exist.
  // 422 - Unprocessable Entity: User ID is missing or invalid.
  // 500 - Internal Server Error: Unexpected server error during device activation.
  @Public()
  @Patch('activate-device/:device_id')
  activateDevice(@Param('device_id') deviceId: string) {
    return this.devicesService.activateDevice(deviceId);
  }
}
