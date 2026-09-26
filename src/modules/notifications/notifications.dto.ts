import { IsNotEmpty, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { StringTransformParams } from '@/common/types/transformer.types';

export class RegisterPushNotificationDto {
  @IsString({ message: 'Installation ID must be a string' })
  @IsNotEmpty()
  installationId!: string;

  @IsString({ message: 'Registration ID must be a string' })
  @IsNotEmpty()
  registrationId!: string;

  @IsString({ message: 'Platform must be a string' })
  @Transform(({ value }: StringTransformParams) => value.toLowerCase())
  @IsNotEmpty()
  platform!: string;

  @IsString({ message: 'Device name must be a string' })
  deviceName?: string;
}
