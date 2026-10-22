import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SubmitApplicationDto {
  @IsString() @MinLength(3) @MaxLength(120) name!: string;
  @IsIn(['barangay', 'police']) type!: 'barangay' | 'police';
  @IsString() @MinLength(2) @MaxLength(100) region!: string;
  @IsOptional() @IsString() @MaxLength(100) province?: string;
  @IsString() @MinLength(2) @MaxLength(100) city!: string;
  @IsString() @MinLength(2) @MaxLength(100) barangay!: string;
  @IsString() @MinLength(5) @MaxLength(250) address!: string;
  @IsString() @MinLength(7) @MaxLength(30) phone!: string;
  @IsEmail() officialEmail!: string;
  @IsString() @MinLength(2) @MaxLength(120) representative!: string;
  @IsString() @MinLength(2) @MaxLength(100) position!: string;
  @IsString() @MinLength(7) @MaxLength(30) representativePhone!: string;
  @IsEmail() representativeEmail!: string;
  @IsString() @MinLength(10) @MaxLength(2000) verificationInfo!: string;
}

export class ReviewApplicationDto {
  @IsIn(['approved', 'rejected', 'needs_info']) status!: 'approved' | 'rejected' | 'needs_info';
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class TransitionIncidentDto {
  @IsIn(['acknowledged', 'in_progress', 'resolved', 'closed', 'cancelled'])
  status!: 'acknowledged' | 'in_progress' | 'resolved' | 'closed' | 'cancelled';
  @IsOptional() @IsString() @MaxLength(2000) resolution?: string;
}

export class IncidentNoteDto {
  @IsString() @MinLength(1) @MaxLength(2000) text!: string;
}
