import { Controller } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { Post, Body } from '@nestjs/common';
import { DeviceRegistrationDto } from './devices.dto';
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
      deviceId: body.device_id,
      deviceType: body.device_type,
      status: body.status,
    });
  }
}
