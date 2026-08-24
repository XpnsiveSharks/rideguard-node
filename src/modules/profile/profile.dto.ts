import { IsOptional, IsString } from 'class-validator';

export class CreateEmergencyContactDto {
  @IsString()
  @IsOptional()
  contact_name?: string;

  @IsString()
  @IsOptional()
  emergency_phone_number?: string;

  @IsString()
  @IsOptional()
  relationship?: string;
}

export class CreateProfileDto extends CreateEmergencyContactDto {
  @IsString()
  first_name!: string;

  @IsString()
  last_name!: string;

  @IsString()
  phone_number!: string;

  @IsString()
  vehicle!: string;

  @IsString()
  plate_number!: string;
}
