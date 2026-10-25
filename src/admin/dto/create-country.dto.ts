import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

const MAX_NAME_LENGTH = 100;

export class CreateCountryDto {
  @ApiProperty({ example: 'Kazakhstan', maxLength: MAX_NAME_LENGTH })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NAME_LENGTH)
  name: string;
}
