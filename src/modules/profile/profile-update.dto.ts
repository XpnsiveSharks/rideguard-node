import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const PHONE_PATTERN = /^\+?[1-9]\d{7,14}$/;
const TEXT_PATTERN = /^(?=.*\S).+$/;

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(TEXT_PATTERN, { message: 'first_name must not be blank' })
  first_name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(TEXT_PATTERN, { message: 'last_name must not be blank' })
  last_name?: string;

  @IsOptional()
  @IsString()
  @Matches(PHONE_PATTERN, { message: 'phone_number must be a valid phone number' })
  phone_number?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(TEXT_PATTERN, { message: 'brand must not be blank' })
  brand?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(TEXT_PATTERN, { message: 'model must not be blank' })
  model?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  @Matches(TEXT_PATTERN, { message: 'plate_number must not be blank' })
  plate_number?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  @Matches(TEXT_PATTERN, { message: 'color must not be blank' })
  color?: string;
}
