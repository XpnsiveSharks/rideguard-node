import { Module, Global } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { DeviceRepository } from './infrastructure/devices.repository';

@Global()
@Module({
  controllers: [DevicesController],
  providers: [DevicesService, DeviceRepository],
  exports: [DevicesService],
})
export class DevicesModule {}
