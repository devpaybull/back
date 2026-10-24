import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserNote } from './entities/user-note.entity';

@Injectable()
export class UserNotesService {
  constructor(
    @InjectRepository(UserNote)
    private readonly notes: Repository<UserNote>,
  ) {}

  findByUserId(userId: string): Promise<UserNote | null> {
    return this.notes.findOne({
      where: { userId },
      relations: { author: true },
    });
  }

  async write(
    userId: string,
    text: string,
    authorUserId: string,
  ): Promise<UserNote> {
    const existing = await this.notes.findOne({ where: { userId } });

    const note = existing
      ? this.notes.merge(existing, { text, authorUserId })
      : this.notes.create({ userId, text, authorUserId });

    await this.notes.save(note);

    return this.findByUserId(userId);
  }

  async delete(userId: string): Promise<void> {
    const existing = await this.notes.findOne({ where: { userId } });

    if (!existing) throw new NotFoundException('Note not found');

    await this.notes.delete({ userId });
  }
}
