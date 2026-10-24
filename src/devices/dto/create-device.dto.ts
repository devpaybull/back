import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const MAX_NAME_LENGTH = 100;

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateDeviceDto {
  @ApiProperty({
    example: 'Pixel 7',
    maxLength: MAX_NAME_LENGTH,
    description:
      'The only field the owner supplies; the phone app fills the rest in',
  })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME_LENGTH)
  name: string;
}
