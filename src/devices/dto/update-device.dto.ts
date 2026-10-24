import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const MAX_NAME_LENGTH = 100;

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateDeviceDto {
  @ApiPropertyOptional({ example: 'Pixel 7', maxLength: MAX_NAME_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME_LENGTH)
  name?: string;
}
