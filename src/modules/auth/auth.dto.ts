import { IsArray, IsEmail, IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';
import { GMAIL_PATTERN, PASSWORD_MIN_LENGTH, USERNAME_PATTERN } from './auth.validation';

export class RegisterDto {
  @IsString()
  @Matches(USERNAME_PATTERN, {
    message: 'username must be 3-24 lowercase letters, numbers, periods, or underscores',
  })
  username!: string;

  @IsEmail()
  @Matches(GMAIL_PATTERN, { message: 'email must use the @gmail.com domain' })
  email!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  })
  @Matches(/[A-Za-z]/, { message: 'password must contain a letter' })
  @Matches(/\d/, { message: 'password must contain a number' })
  password!: string;
}

export class VerifyEmailCodeDto {
  @IsEmail()
  @Matches(GMAIL_PATTERN, { message: 'email must use the @gmail.com domain' })
  email!: string;

  @IsString()
  @Length(6, 6, { message: 'code must be exactly 6 digits' })
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code!: string;
}

export class ResendVerificationCodeDto {
  @IsEmail()
  @Matches(GMAIL_PATTERN, { message: 'email must use the @gmail.com domain' })
  email!: string;
}

export class LoginDto {
  @IsString()
  identifier!: string;

  @IsString()
  password!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @Matches(GMAIL_PATTERN, { message: 'email must use the @gmail.com domain' })
  email!: string;
}

export class DeleteAccountDto {
  @IsString()
  password!: string;
}

export class UpdateOnboardingDto {
  @IsOptional()
  @IsString()
  step?: string;

  @IsOptional()
  @IsArray()
  completedSteps?: string[];

  @IsOptional()
  data?: Record<string, unknown>;
}

export class EnrollPhoneKeyDto {
  @IsString()
  deviceId!: string;

  @IsString()
  publicKey!: string;

  @IsOptional()
  @IsString()
  algorithm?: string;
}

export class PhoneAuthChallengeDto {
  @IsString()
  deviceId!: string;
}

export class VerifyPhoneSignatureDto {
  @IsString()
  deviceId!: string;

  @IsString()
  challengeId!: string;

  @IsString()
  signature!: string;
}

export class RevokePhoneKeyDto {
  @IsString()
  deviceId!: string;
}
