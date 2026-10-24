import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class RedeemLoginLinkDto {
  @ApiProperty({ description: 'The code carried by the one-time login link' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  code: string;

  @ApiPropertyOptional({
    description:
      'Accepted and ignored: a session opened by a login link records no login footprint',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  fingerprint?: string;
}
