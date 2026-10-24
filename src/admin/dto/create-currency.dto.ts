import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

const MAX_NAME_LENGTH = 100;
const MAX_ISOCODE_LENGTH = 16;

export class CreateCurrencyDto {
  @ApiProperty({ example: 'Kazakhstani tenge', maxLength: MAX_NAME_LENGTH })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NAME_LENGTH)
  name: string;

  @ApiProperty({ example: 'KZT', maxLength: MAX_ISOCODE_LENGTH })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_ISOCODE_LENGTH)
  isocode: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  countryId: number;
}
