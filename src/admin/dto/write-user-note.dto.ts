import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export const USER_NOTE_MAX_LENGTH = 2000;

export class WriteUserNoteDto {
  @ApiProperty({ maxLength: USER_NOTE_MAX_LENGTH })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(USER_NOTE_MAX_LENGTH)
  text: string;
}
