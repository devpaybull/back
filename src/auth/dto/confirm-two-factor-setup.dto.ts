import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { TOTP_PATTERN } from '../../common/utils/totp-pattern';

export class ConfirmTwoFactorSetupDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  setupToken: string;

  @ApiProperty({ example: '123456' })
  @Matches(TOTP_PATTERN, { message: 'totp must be a 6-digit code' })
  totp: string;

  @ApiPropertyOptional({
    description: 'Browser fingerprint, stored with the login footprint',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  fingerprint?: string;
}
