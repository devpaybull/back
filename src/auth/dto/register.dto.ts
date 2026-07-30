import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email or telegram username the invite was issued for',
  })
  @IsString()
  @IsNotEmpty()
  login: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiProperty({ example: 'A7K2M9QRSTUVWXYZ' })
  @IsString()
  @IsNotEmpty()
  inviteCode: string;
}
