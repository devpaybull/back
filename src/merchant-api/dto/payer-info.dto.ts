import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIP,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const EPOCH_MS_OR_ISO_INSTANT =
  /^(\d{1,16}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2}))$/;

export class PayerInfoDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 255,
    description: 'The client’s id on the merchant’s side',
  })
  @IsString()
  @Length(1, 255)
  userId: string;

  @ApiPropertyOptional({ example: '203.0.113.7' })
  @IsOptional()
  @IsIP()
  ip?: string;

  @ApiPropertyOptional({ maxLength: 1024 })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  userAgent?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fingerprint?: string;

  @ApiPropertyOptional({
    example: '1730700000000',
    description:
      'Milliseconds since the epoch, or an ISO 8601 date-time with a zone',
  })
  @IsOptional()
  @IsString()
  @Matches(EPOCH_MS_OR_ISO_INSTANT)
  registeredAt?: string;
}
