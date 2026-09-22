import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateAlertSeenDto {
  @IsBoolean()
  isSeen!: boolean;
}

export class GetAlertsQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1500)
  @Matches(/^[^/]+$/, { message: 'cursor must be a valid alert ID' })
  cursor?: string;
}
