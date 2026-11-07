import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const MAX_TOKEN_LENGTH = 200;
const MAX_MODEL_LENGTH = 100;
const MAX_APP_VERSION_LENGTH = 50;
const MAX_PHONE_LENGTH = 32;
const PHONE_PATTERN = /^\+?\d+$/;

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class PairDeviceDto {
  @ApiProperty({ description: 'The pairingToken read from the QR code' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TOKEN_LENGTH)
  pairingToken: string;

  @ApiPropertyOptional({
    example: 'Google Pixel 7',
    maxLength: MAX_MODEL_LENGTH,
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_MODEL_LENGTH)
  model?: string;

  @ApiPropertyOptional({ example: '1.0.0', maxLength: MAX_APP_VERSION_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_APP_VERSION_LENGTH)
  appVersion?: string;

  @ApiPropertyOptional({ example: '+79161234567', maxLength: MAX_PHONE_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Matches(PHONE_PATTERN)
  @MaxLength(MAX_PHONE_LENGTH)
  phone?: string;
}
