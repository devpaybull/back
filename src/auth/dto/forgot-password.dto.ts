import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email or telegram username the account is known by',
  })
  @IsString()
  @IsNotEmpty()
  login: string;
}
