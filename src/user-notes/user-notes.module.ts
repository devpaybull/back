import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserNote } from './entities/user-note.entity';
import { UserNotesService } from './user-notes.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserNote])],
  providers: [UserNotesService],
  exports: [UserNotesService],
})
export class UserNotesModule {}
