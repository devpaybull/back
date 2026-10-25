import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AuthenticatedUser } from '../../common/types/token';
import { UserNote } from '../../user-notes/entities/user-note.entity';
import { User } from '../../users/entities/user.entity';
import { UserStatus } from '../../users/types/user-status.enum';
import { AdminUserNotesController } from '../controllers/admin-user-notes.controller';

describe('AdminUserNotesController', () => {
  const admin: AuthenticatedUser = {
    id: uuidOf(9),
    login: 'admin@example.com',
    role: Role.Admin,
    status: UserStatus.Active,
  };
  const superadmin: AuthenticatedUser = { ...admin, role: Role.Superadmin };
  const target = { id: uuidOf(1), role: Role.Trader } as User;
  const created = new Date('2026-01-01T00:00:00Z');
  const note = {
    text: 'watch this one',
    authorUserId: admin.id,
    author: {
      id: admin.id,
      email: 'admin@example.com',
      telegramUsername: null,
    },
    createdAt: created,
    updatedAt: created,
  } as unknown as UserNote;

  let notes: { findByUserId: jest.Mock; write: jest.Mock; delete: jest.Mock };
  let directory: { findById: jest.Mock };
  let controller: AdminUserNotesController;

  beforeEach(() => {
    notes = {
      findByUserId: jest.fn(),
      write: jest.fn(),
      delete: jest.fn(),
    };
    directory = { findById: jest.fn().mockResolvedValue(target) };
    controller = new AdminUserNotesController(
      notes as never,
      directory as never,
    );
  });

  it('is guarded for admin and superadmin only', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminUserNotesController),
    ).toEqual([Role.Admin, Role.Superadmin]);
  });

  it('marks write and remove as writes and read as not', () => {
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.write),
    ).toBe(true);
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.remove),
    ).toBe(true);
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.read),
    ).toBeUndefined();
  });

  describe('read', () => {
    it('404 for an unknown user', async () => {
      directory.findById.mockResolvedValue(null);

      await expect(controller.read(uuidOf(1))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns null when there is no note', async () => {
      notes.findByUserId.mockResolvedValue(null);

      await expect(controller.read(uuidOf(1))).resolves.toBeNull();
    });

    it('returns the note with the author login', async () => {
      notes.findByUserId.mockResolvedValue(note);

      await expect(controller.read(uuidOf(1))).resolves.toEqual({
        text: 'watch this one',
        author: { id: admin.id, login: 'admin@example.com' },
        createdAt: created,
        updatedAt: created,
      });
    });

    it('is open for notes on admins too', async () => {
      directory.findById.mockResolvedValue({
        id: uuidOf(2),
        role: Role.Superadmin,
      });
      notes.findByUserId.mockResolvedValue(null);

      await expect(controller.read(uuidOf(2))).resolves.toBeNull();
    });
  });

  describe('write', () => {
    it('takes the author from the token', async () => {
      notes.write.mockResolvedValue(note);

      await controller.write(uuidOf(1), { text: 'hi' }, admin);

      expect(notes.write).toHaveBeenCalledWith(uuidOf(1), 'hi', admin.id);
    });

    it('404 for an unknown user', async () => {
      directory.findById.mockResolvedValue(null);

      await expect(
        controller.write(uuidOf(1), { text: 'hi' }, admin),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('403 when an admin writes on an admin', async () => {
      directory.findById.mockResolvedValue({ id: uuidOf(2), role: Role.Admin });

      await expect(
        controller.write(uuidOf(2), { text: 'hi' }, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(notes.write).not.toHaveBeenCalled();
    });

    it('lets a superadmin write on an admin', async () => {
      directory.findById.mockResolvedValue({ id: uuidOf(2), role: Role.Admin });
      notes.write.mockResolvedValue(note);

      await controller.write(uuidOf(2), { text: 'hi' }, superadmin);

      expect(notes.write).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the note of an allowed target', async () => {
      await controller.remove(uuidOf(1), admin);

      expect(notes.delete).toHaveBeenCalledWith(uuidOf(1));
    });

    it('403 when an admin deletes a note on a superadmin', async () => {
      directory.findById.mockResolvedValue({
        id: uuidOf(2),
        role: Role.Superadmin,
      });

      await expect(controller.remove(uuidOf(2), admin)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(notes.delete).not.toHaveBeenCalled();
    });

    it('404 for an unknown user', async () => {
      directory.findById.mockResolvedValue(null);

      await expect(controller.remove(uuidOf(1), admin)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
