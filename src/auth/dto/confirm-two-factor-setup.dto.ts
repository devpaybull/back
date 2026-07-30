import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { TOTP_PATTERN } from './confirm-registration.dto';

export class ConfirmTwoFactorSetupDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  setupToken: string;

  @ApiProperty({ example: '123456' })
  @Matches(TOTP_PATTERN, { message: 'totp must be a 6-digit code' })
  totp: string;
}
