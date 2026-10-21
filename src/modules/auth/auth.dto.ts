import { IsEmail, IsString, Matches, MinLength } from 'class-validator';
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
