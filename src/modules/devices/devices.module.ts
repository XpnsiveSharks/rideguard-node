import { Module, Global } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { DeviceRepository } from './infrastructure/devices.repository';
import { DeviceTokenService } from './device-token.service';

@Global()
@Module({
  controllers: [DevicesController],
  providers: [DevicesService, DeviceRepository, DeviceTokenService],
  exports: [DevicesService],
})
export class DevicesModule {}
