import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const MAX_APP_VERSION_LENGTH = 50;

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class DeviceHeartbeatDto {
  @ApiPropertyOptional({ example: '1.0.1', maxLength: MAX_APP_VERSION_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_APP_VERSION_LENGTH)
  appVersion?: string;
}
