import { IsEnum } from 'class-validator';
import { StringTransformParams } from '@/common/types/transformer.types';
import { Transform } from 'class-transformer';
import { DeviceType } from './domain/device.entity';

export class DeviceRegistrationDto {
  @Transform(({ value }: StringTransformParams) => value?.toLowerCase())
  @IsEnum(DeviceType, { message: 'Device type must be one of: camera, button' })
  device_type!: DeviceType;
}
