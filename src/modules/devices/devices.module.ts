import { Module, Global } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { DeviceRepository } from './infrastructure/devices.repository';
import { DeviceTokenService } from './device-token.service';
import { PhoneCamerasController } from './phone-cameras.controller';
import { PhoneCameraService } from './phone-camera.service';
import { PhoneCameraRepository } from './infrastructure/phone-cameras.repository';

@Global()
@Module({
  controllers: [DevicesController, PhoneCamerasController],
  providers: [
    DevicesService,
    DeviceRepository,
    DeviceTokenService,
    PhoneCameraService,
    PhoneCameraRepository,
  ],
  exports: [DevicesService],
})
export class DevicesModule {}
