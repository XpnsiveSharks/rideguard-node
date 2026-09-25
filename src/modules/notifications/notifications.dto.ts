import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { PushPlatform } from './domain/push-registration.entity';

export class RegisterPushNotificationDto {
  @IsString({ message: 'Installation ID must be a string' })
  @IsNotEmpty()
  installationId!: string;

  @IsString({ message: 'Registration ID must be a string' })
  @IsNotEmpty()
  registrationId!: string;

  @IsString({ message: 'Platform must be a string' })
  @IsEnum(PushPlatform, { message: 'Platform must be either "ANDROID", "IOS" or "WEB' })
  @IsNotEmpty()
  platform!: PushPlatform;

  @IsString({ message: 'Device name must be a string' })
  deviceName?: string;
}
