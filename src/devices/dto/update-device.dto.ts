import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { DeviceType } from '../types/device-type.enum';

const MAX_NAME_LENGTH = 100;
const MAX_PHONE_LENGTH = 32;
const PHONE_PATTERN = /^\+?\d+$/;

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateDeviceDto {
  @ApiPropertyOptional({ enum: DeviceType })
  @IsOptional()
  @IsEnum(DeviceType)
  type?: DeviceType;

  @ApiPropertyOptional({ example: 'Pixel 7', maxLength: MAX_NAME_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    example: 'Google Pixel 7',
    maxLength: MAX_NAME_LENGTH,
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME_LENGTH)
  model?: string;

  @ApiPropertyOptional({ example: '+79161234567', maxLength: MAX_PHONE_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Matches(PHONE_PATTERN)
  @MaxLength(MAX_PHONE_LENGTH)
  phone?: string;
}
