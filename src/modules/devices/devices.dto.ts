import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ONE_MINUTE_IN_MILLISECONDS } from '@/common/constants/time.constants';
import { StringTransformParams } from '@/common/types/transformer.types';
import { Transform } from 'class-transformer';
import { DeviceType } from './domain/device.entity';

export class DeviceRegistrationDto {
  @Transform(({ value }: StringTransformParams) => value?.toLowerCase())
  @IsEnum(DeviceType, { message: 'Device type must be one of: camera, button' })
  device_type!: DeviceType;
}

export class ReportStreamUrlDto {
  // The board reports a plain-HTTP LAN URL (e.g. http://192.168.1.42/stream),
  // so require_tld is off to allow bare IPs and .local hostnames.
  @Transform(({ value }: StringTransformParams) => value?.trim())
  @IsUrl(
    { protocols: ['http', 'https'], require_tld: false },
    { message: 'stream_url must be a valid http(s) URL' },
  )
  stream_url!: string;
}

export class RegisterPhoneCameraDto {
  // The app's per-install UUID (also used for push registration).
  @Transform(({ value }: StringTransformParams) => value?.trim())
  @IsString()
  @Length(8, 128)
  @Matches(/^[A-Za-z0-9-]+$/, { message: 'installation_id must be letters, digits, or dashes' })
  installation_id!: string;
}

export class StartPhoneSessionDto {
  // The upper bound is PHONE_SESSION_MAX_DURATION_MS, checked in the service.
  @IsInt()
  @Min(ONE_MINUTE_IN_MILLISECONDS)
  @Max(24 * 60 * ONE_MINUTE_IN_MILLISECONDS)
  duration_ms!: number;
}

export class VerifyPhoneUploadDto {
  @IsString()
  @Length(1, 256)
  upload_token!: string;
}

export class PhonePresenceDto {
  @IsBoolean()
  connected!: boolean;
}
