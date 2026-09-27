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
  // route: POST /devices
  @Post()
  registerDevice(
    @Body()
    body: DeviceRegistrationDto,
  ): Promise<string> {
    return this.devicesService.registerDevice(body.device_type);
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
}
