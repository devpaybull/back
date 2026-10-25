import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const MAX_NAME_LENGTH = 100;
const MAX_ISOCODE_LENGTH = 16;

export class UpdateCurrencyDto {
  @ApiPropertyOptional({
    example: 'Kazakhstani tenge',
    maxLength: MAX_NAME_LENGTH,
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NAME_LENGTH)
  name?: string;

  @ApiPropertyOptional({ example: 'KZT', maxLength: MAX_ISOCODE_LENGTH })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_ISOCODE_LENGTH)
  isocode?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  countryId?: number;
}
