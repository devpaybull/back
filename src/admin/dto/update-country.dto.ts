import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const MAX_NAME_LENGTH = 100;

export class UpdateCountryDto {
  @ApiPropertyOptional({ example: 'Kazakhstan', maxLength: MAX_NAME_LENGTH })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NAME_LENGTH)
  name?: string;
}
