import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Relationship } from './domain/emergency-contact.value-object';
export class CreateEmergencyContactDto {
  @IsString()
  @IsOptional()
  contact_name?: string;

  @IsString()
  @IsOptional()
  emergency_phone_number?: string;

  @IsEnum(Relationship, { message: 'Invalid relationship type' })
  @IsOptional()
  relationship?: Relationship;
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
