import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class SosLocationDto {
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsISO8601({ strict: true })
  capturedAt!: string;

  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  accuracyMeters?: number | null;
}

export class StartSosDto {
  @IsUUID()
  requestId!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^[^/]+$/)
  @MaxLength(1500)
  alertId?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => SosLocationDto)
  location?: SosLocationDto | null;
}
