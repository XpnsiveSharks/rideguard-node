import { IsEmail, IsEnum, IsOptional, IsString, Matches } from 'class-validator';

export enum ContactRelationship {
  Parent = 'Parent',
  Sibling = 'Sibling',
  Spouse = 'Spouse',
  Child = 'Child',
  Friend = 'Friend',
  Other = 'Other',
}

export class EmergencyContactDto {
  @IsString()
  name!: string;

  @Matches(/^\+639\d{9}$/, {
    message: 'phone must be a +63 Philippine mobile number with 10 digits',
  })
  phone!: string;

  @IsEmail()
  email!: string;

  @IsEnum(ContactRelationship)
  relationship!: ContactRelationship;
}

export class UpdateEmergencyContactDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @Matches(/^\+639\d{9}$/, {
    message: 'phone must be a +63 Philippine mobile number with 10 digits',
  })
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(ContactRelationship)
  relationship?: ContactRelationship;
}
