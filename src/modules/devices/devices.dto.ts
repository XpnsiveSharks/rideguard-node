import { IsEnum } from 'class-validator';
import { DeviceType } from './domain/device.entity';

export class DeviceRegistrationDto {
  @IsEnum(DeviceType, { message: 'Invalid device type' })
  device_type!: DeviceType;
}
