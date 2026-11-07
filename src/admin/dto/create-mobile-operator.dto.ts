import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const MAX_CODE_LENGTH = 64;
const MAX_NAME_LENGTH = 128;

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateMobileOperatorDto {
  @ApiProperty({ example: 'mts', maxLength: MAX_CODE_LENGTH })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_CODE_LENGTH)
  code: string;

  @ApiProperty({ example: 'MTS', maxLength: MAX_NAME_LENGTH })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NAME_LENGTH)
  name: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  countryId: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
