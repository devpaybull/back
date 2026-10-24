import { ApiProperty } from '@nestjs/swagger';
import { loginOf } from '../../common/utils/login-of';
import { UserNote } from '../../user-notes/entities/user-note.entity';

export class UserNoteAuthorDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  login: string;
}

export class UserNoteDto {
  @ApiProperty()
  text: string;

  @ApiProperty({ type: UserNoteAuthorDto })
  author: UserNoteAuthorDto;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

export const toUserNoteDto = (note: UserNote): UserNoteDto => ({
  text: note.text,
  author: { id: note.author.id, login: loginOf(note.author) },
  createdAt: note.createdAt,
  updatedAt: note.updatedAt,
});
