import { NotFoundException } from '@nestjs/common';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { UserNote } from '../entities/user-note.entity';
import { UserNotesService } from '../user-notes.service';

describe('UserNotesService', () => {
  let rows: Partial<UserNote>[];
  let repo: {
    findOne: jest.Mock;
    create: jest.Mock;
    merge: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let service: UserNotesService;

  beforeEach(() => {
    rows = [];
    repo = {
      findOne: jest.fn(({ where }) =>
        Promise.resolve(rows.find((r) => r.userId === where.userId) ?? null),
      ),
      create: jest.fn((data) => ({ ...data })),
      merge: jest.fn((row, data) => Object.assign(row, data)),
      save: jest.fn((row) => {
        if (!rows.includes(row)) rows.push(row);
        return Promise.resolve(row);
      }),
      delete: jest.fn(({ userId }) => {
        rows = rows.filter((r) => r.userId !== userId);
        return Promise.resolve();
      }),
    };
    service = new UserNotesService(repo as never);
  });

  it('finds a note with its author loaded', async () => {
    await service.findByUserId(uuidOf(1));

    expect(repo.findOne).toHaveBeenCalledWith({
      where: { userId: uuidOf(1) },
      relations: { author: true },
    });
  });

  it('returns null when there is no note', async () => {
    await expect(service.findByUserId(uuidOf(1))).resolves.toBeNull();
  });

  it('creates a note when none exists', async () => {
    const note = await service.write(uuidOf(1), 'hello', uuidOf(9));

    expect(repo.create).toHaveBeenCalledWith({
      userId: uuidOf(1),
      text: 'hello',
      authorUserId: uuidOf(9),
    });
    expect(note.text).toBe('hello');
    expect(rows).toHaveLength(1);
  });

  it('replaces the text and the author of an existing note, keeping one row', async () => {
    await service.write(uuidOf(1), 'first', uuidOf(8));
    const note = await service.write(uuidOf(1), 'second', uuidOf(9));

    expect(rows).toHaveLength(1);
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(note.text).toBe('second');
    expect(note.authorUserId).toBe(uuidOf(9));
  });

  it('deletes the note', async () => {
    await service.write(uuidOf(1), 'x', uuidOf(9));

    await service.delete(uuidOf(1));

    expect(rows).toHaveLength(0);
  });

  it('404 when deleting a note that does not exist', async () => {
    await expect(service.delete(uuidOf(1))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.delete).not.toHaveBeenCalled();
  });
});
