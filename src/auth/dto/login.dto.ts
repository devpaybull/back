import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { TOTP_PATTERN } from '../../common/utils/totp-pattern';

export class LoginDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email or telegram username the account was invited by',
  })
  @IsString()
  @IsNotEmpty()
  login: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiPropertyOptional({
    example: '123456',
    description: 'Required unless a backup code is supplied',
  })
  @ValidateIf((dto: LoginDto) => !dto.backupCode)
  @Matches(TOTP_PATTERN, { message: 'totp must be a 6-digit code' })
  totp?: string;

  @ApiPropertyOptional({
    example: 'A1B2C-3D4E5',
    description: 'One-time backup code, accepted instead of totp',
  })
  @ValidateIf((dto: LoginDto) => !dto.totp)
  @IsString()
  @IsNotEmpty()
  backupCode?: string;

  @ApiPropertyOptional({
    description: 'Browser fingerprint, stored with the login footprint',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  fingerprint?: string;
}
