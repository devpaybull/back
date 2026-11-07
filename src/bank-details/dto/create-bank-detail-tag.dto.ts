import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const MAX_TAG_NAME_LENGTH = 50;

export class CreateBankDetailTagDto {
  @ApiProperty({
    example: 'Сбер основные',
    maxLength: MAX_TAG_NAME_LENGTH,
    description:
      'Trimmed; unique per account regardless of letter case (409 otherwise)',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TAG_NAME_LENGTH)
  name: string;
}
