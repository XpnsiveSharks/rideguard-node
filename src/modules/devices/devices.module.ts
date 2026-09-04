import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { DeviceRepository } from './infrastructure/devices.repository';

@Module({
  controllers: [DevicesController],
  providers: [DevicesService, DeviceRepository],
})
export class DevicesModule {}
