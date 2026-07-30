import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export const EMAIL_CONFIRMATION_CODE_PATTERN = /^\d{6}$/;

export class ConfirmEmailDto {
  @ApiProperty({ example: '123456' })
  @Matches(EMAIL_CONFIRMATION_CODE_PATTERN, {
    message: 'code must be a 6-digit code',
  })
  code: string;
}
