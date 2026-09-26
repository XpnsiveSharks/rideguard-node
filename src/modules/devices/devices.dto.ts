import { IsNotEmpty, IsString } from 'class-validator';
import { StringTransformParams } from '@/common/types/transformer.types';
import { Transform } from 'class-transformer';

export class DeviceRegistrationDto {
  @IsString({ message: 'Device type must be a string' })
  @IsNotEmpty({ message: 'Device type is required' })
  @Transform(({ value }: StringTransformParams) => value.toLowerCase())
  device_type!: string;
}
