import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { DeviceType } from '../types/device-type.enum';

const MAX_NAME_LENGTH = 100;

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateDeviceDto {
  @ApiPropertyOptional({ enum: DeviceType, default: DeviceType.Android })
  @IsOptional()
  @IsEnum(DeviceType)
  type?: DeviceType;

  @ApiProperty({
    example: 'Pixel 7',
    maxLength: MAX_NAME_LENGTH,
    description:
      'The owner names the device; the phone app reports its model, phone and version when it pairs',
  })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME_LENGTH)
  name: string;
}
