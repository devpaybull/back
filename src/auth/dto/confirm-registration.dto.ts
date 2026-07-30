import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export const TOTP_PATTERN = /^\d{6}$/;

export class ConfirmRegistrationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  registrationToken: string;

  @ApiProperty({ example: '123456' })
  @Matches(TOTP_PATTERN, { message: 'totp must be a 6-digit code' })
  totp: string;
}
