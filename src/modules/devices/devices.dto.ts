import { IsEnum, IsUrl } from 'class-validator';
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
