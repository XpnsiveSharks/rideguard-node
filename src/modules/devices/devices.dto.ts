import { IsEnum, IsString } from 'class-validator';
import { DeviceStatus, DeviceType } from './domain/device.entity';

export class DeviceRegistrationDto {
  @IsString()
  device_id!: string;

  @IsEnum(DeviceType, { message: 'Invalid device type' })
  device_type!: DeviceType;

  @IsEnum(DeviceStatus, { message: 'Invalid device status' })
  status!: DeviceStatus;
}
