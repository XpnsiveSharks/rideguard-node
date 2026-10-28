import { IsNumber, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const PIN = /^\d{4}$/;
const CODE = /^\d{6}$/;

export class MpinPinDto {
  @IsString()
  @Matches(PIN, { message: 'pin must be exactly four digits' })
  pin!: string;
}

export class MpinCurrentPinDto extends MpinPinDto {}

export class MpinAuthorizationDto {
  @IsString()
  @MaxLength(512)
  authorization!: string;

  @IsString()
  @Matches(PIN, { message: 'pin must be exactly four digits' })
  pin!: string;
}

export class MpinChangeCodeRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  authorization?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  currentPinProof?: string;
}

export class MpinChallengeDto {
  @IsString()
  @MaxLength(128)
  challengeId!: string;
}

export class MpinVerifyCodeDto extends MpinChallengeDto {
  @IsString()
  @Matches(CODE, { message: 'code must be exactly six digits' })
  code!: string;
}

export class MpinStatusContextDto {
  @IsOptional()
  @IsString()
  reason?: 'launch' | 'resume' | 'expiry';

  @IsOptional()
  @IsNumber()
  inactiveForMs?: number;
}

export class MpinUnlockDto extends MpinPinDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string;
}

export class MpinEmailLinkRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  authorization?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string;
}

export class MpinEmailLinkChangeDto {
  @IsString()
  @MaxLength(512)
  token!: string;

  @IsString()
  @Matches(PIN, { message: 'pin must be exactly four digits' })
  pin!: string;
}
