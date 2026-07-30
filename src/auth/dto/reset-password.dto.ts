import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export const RESET_CODE_PATTERN = /^\d{6}$/;

export class ResetPasswordDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email or telegram username the account is known by',
  })
  @IsString()
  @IsNotEmpty()
  login: string;

  @ApiProperty({
    example: '123456',
    description: 'The code from the recovery message, or from its link',
  })
  @Matches(RESET_CODE_PATTERN, { message: 'code must be a 6-digit code' })
  code: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}
