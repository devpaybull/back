import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { hash } from 'bcryptjs';
import { EntityManager, QueryFailedError } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { UserBackupCode } from '../entities/user-backup-code.entity';
import { User } from '../entities/user.entity';
import { UserAdministrationService } from '../services/user-administration.service';
import { UserCredentialsService } from '../services/user-credentials.service';
import {
  IDENTIFIER_TAKEN,
  TELEGRAM_ID_TAKEN,
  UserDirectoryService,
} from '../services/user-directory.service';
import { UserStatus } from '../types/user-status.enum';
import { createFakeRepository, FakeRepository } from './fake-repository.spec';

describe('UserAdministrationService', () => {
  const activeUser = (patch: Partial<User> = {}): Partial<User> => ({
    id: uuidOf(1),
    email: 'user@example.com',
    emailVerified: true,
    role: Role.Trader,
    status: UserStatus.Active,
    ...patch,
  });

  let stored: Partial<User>[];
  let users: FakeRepository;
  let service: UserAdministrationService;
  let directory: UserDirectoryService;
  let credentials: UserCredentialsService;

  beforeEach(async () => {
    stored = [];
    users = createFakeRepository(stored);

    const module = await Test.createTestingModule({
      providers: [
        UserAdministrationService,
        UserDirectoryService,
        UserCredentialsService,
        { provide: getRepositoryToken(User), useValue: users },
        {
          provide: getRepositoryToken(UserBackupCode),
          useValue: createFakeRepository([]),
        },
      ],
    }).compile();

    service = module.get(UserAdministrationService);
    directory = module.get(UserDirectoryService);
    credentials = module.get(UserCredentialsService);
  });

  it('rejects an unknown user', async () => {
    await expect(
      service.update(uuidOf(404), { role: Role.Merchant }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(users.save).not.toHaveBeenCalled();
  });

  it('writes through the given transaction manager instead of its own repository', async () => {
    stored.push(activeUser());
    const transactional = createFakeRepository(stored);
    const manager = { getRepository: jest.fn(() => transactional) };

    await service.update(
      uuidOf(1),
      { role: Role.Merchant },
      manager as unknown as EntityManager,
    );

    expect(manager.getRepository).toHaveBeenCalledWith(User);
    expect(transactional.save).toHaveBeenCalledTimes(1);
    expect(users.save).not.toHaveBeenCalled();
  });

  it('changes the email on its own, normalised', async () => {
    stored.push(activeUser());

    await expect(
      service.update(uuidOf(1), { email: '  Renamed@Example.COM ' }),
    ).resolves.toMatchObject({
      id: uuidOf(1),
      email: 'renamed@example.com',
      role: Role.Trader,
      status: UserStatus.Active,
    });
  });

  it('leaves an email an administrator set unconfirmed, because nobody proved it', async () => {
    stored.push(activeUser());

    await expect(
      service.update(uuidOf(1), { email: 'renamed@example.com' }),
    ).resolves.toMatchObject({
      email: 'renamed@example.com',
      emailVerified: false,
    });
  });

  it('leaves the confirmation alone when the edit is about something else', async () => {
    stored.push(activeUser());

    await expect(
      service.update(uuidOf(1), { role: Role.Cascade }),
    ).resolves.toMatchObject({
      email: 'user@example.com',
      emailVerified: true,
    });
  });

  it('changes the telegram username on its own, normalised', async () => {
    stored.push(activeUser({ email: null, telegramUsername: 'durov' }));

    await expect(
      service.update(uuidOf(1), { telegramUsername: ' @Pavel ' }),
    ).resolves.toMatchObject({ telegramUsername: 'pavel' });
  });

  it('changes the role on its own', async () => {
    stored.push(activeUser());

    await expect(
      service.update(uuidOf(1), { role: Role.MerchantSupport }),
    ).resolves.toMatchObject({
      role: Role.MerchantSupport,
      email: 'user@example.com',
      status: UserStatus.Active,
    });
  });

  it('changes the status on its own', async () => {
    stored.push(activeUser());

    await expect(
      service.update(uuidOf(1), { status: UserStatus.Blocked }),
    ).resolves.toMatchObject({
      status: UserStatus.Blocked,
      role: Role.Trader,
    });
  });

  it('reaches a user of any status', async () => {
    stored.push(activeUser({ status: UserStatus.Blocked }));

    await expect(
      service.update(uuidOf(1), { status: UserStatus.Active }),
    ).resolves.toMatchObject({ status: UserStatus.Active });
  });

  describe('telegram id and groups', () => {
    it('writes both without touching the login', async () => {
      stored.push(activeUser());

      await expect(
        service.update(uuidOf(1), {
          telegramId: '777',
          telegramGroups: 'a / b',
        }),
      ).resolves.toMatchObject({
        telegramId: '777',
        telegramGroups: 'a / b',
        email: 'user@example.com',
      });
    });

    it('clears them with null, and the groups with an empty string', async () => {
      stored.push(activeUser({ telegramId: '777', telegramGroups: 'a' }));

      await expect(
        service.update(uuidOf(1), { telegramId: null, telegramGroups: '' }),
      ).resolves.toMatchObject({ telegramId: null, telegramGroups: null });
    });

    it('leaves them alone when absent', async () => {
      stored.push(activeUser({ telegramId: '777', telegramGroups: 'a' }));

      await expect(
        service.update(uuidOf(1), { role: Role.Cascade }),
      ).resolves.toMatchObject({ telegramId: '777', telegramGroups: 'a' });
    });

    it('answers 409 when another user holds the id', async () => {
      stored.push(
        activeUser(),
        activeUser({
          id: uuidOf(2),
          email: 'b@example.com',
          telegramId: '777',
        }),
      );

      await expect(
        service.update(uuidOf(1), { telegramId: '777' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(users.save).not.toHaveBeenCalled();
    });

    it('lets the holder resend its own id', async () => {
      stored.push(activeUser({ telegramId: '777' }));

      await expect(
        service.update(uuidOf(1), { telegramId: '777' }),
      ).resolves.toMatchObject({ telegramId: '777' });
    });

    const uniqueViolationOn = (detail?: string) =>
      new QueryFailedError('UPDATE', [], {
        code: '23505',
        detail,
      } as unknown as Error);

    it('translates a unique violation on the telegram id into its 409', async () => {
      stored.push(activeUser());
      users.save.mockRejectedValueOnce(
        uniqueViolationOn('Key ("telegramId")=(888) already exists.'),
      );

      await expect(
        service.update(uuidOf(1), { telegramId: '888' }),
      ).rejects.toThrow(new ConflictException(TELEGRAM_ID_TAKEN));
    });

    it.each([
      ['email', 'Key (email)=(race@example.com) already exists.'],
      ['telegramUsername', 'Key ("telegramUsername")=(racer) already exists.'],
    ])(
      'translates a unique violation on %s into the identifier-taken 409',
      async (_column, detail) => {
        stored.push(activeUser());
        users.save.mockRejectedValueOnce(uniqueViolationOn(detail));

        await expect(
          service.update(uuidOf(1), { telegramUsername: 'racer' }),
        ).rejects.toThrow(new ConflictException(IDENTIFIER_TAKEN));
      },
    );

    it.each([
      ['another unique index', 'Key ("merchantId")=(x) already exists.'],
      ['no detail at all', undefined],
    ])(
      'lets a unique violation on %s through untranslated',
      async (_case, detail) => {
        stored.push(activeUser());
        const failure = uniqueViolationOn(detail);
        users.save.mockRejectedValueOnce(failure);

        await expect(
          service.update(uuidOf(1), { telegramId: '888' }),
        ).rejects.toBe(failure);
      },
    );

    it('lets any other database error through', async () => {
      stored.push(activeUser());
      const failure = new QueryFailedError('INSERT', [], {
        code: '08006',
      } as unknown as Error);
      users.save.mockRejectedValueOnce(failure);

      await expect(
        service.update(uuidOf(1), { telegramId: '888' }),
      ).rejects.toBe(failure);
    });
  });

  it('leaves absent fields alone', async () => {
    stored.push(
      activeUser({ telegramUsername: 'durov', passwordHash: 'kept' }),
    );

    await expect(service.update(uuidOf(1), {})).resolves.toMatchObject({
      email: 'user@example.com',
      telegramUsername: 'durov',
      role: Role.Trader,
      status: UserStatus.Active,
      passwordHash: 'kept',
    });
  });

  it('gives a user both identifiers, and either one finds them', async () => {
    stored.push(activeUser({ telegramUsername: null }));

    const updated = await service.update(uuidOf(1), {
      telegramUsername: '@Durov',
    });

    expect(updated).toMatchObject({
      email: 'user@example.com',
      telegramUsername: 'durov',
    });
    await expect(directory.findByLogin('user@example.com')).resolves.toBe(
      stored[0],
    );
    await expect(directory.findByLogin('durov')).resolves.toBe(stored[0]);
    await expect(directory.findAuthenticatableByLogin('@Durov')).resolves.toBe(
      stored[0],
    );
  });

  it('sets both identifiers in one call', async () => {
    stored.push(activeUser({ email: null, telegramUsername: 'durov' }));

    await expect(
      service.update(uuidOf(1), {
        email: 'User@Example.com',
        telegramUsername: 'pavel',
      }),
    ).resolves.toMatchObject({
      email: 'user@example.com',
      telegramUsername: 'pavel',
    });
  });

  it('rejects an email already held by another user', async () => {
    stored.push(activeUser(), {
      id: uuidOf(2),
      email: 'taken@example.com',
      status: UserStatus.Active,
    });

    await expect(
      service.update(uuidOf(1), { email: ' Taken@Example.com ' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(users.save).not.toHaveBeenCalled();
  });

  it('rejects a telegram username already held by another user', async () => {
    stored.push(activeUser(), {
      id: uuidOf(2),
      telegramUsername: 'durov',
      status: UserStatus.Blocked,
    });

    await expect(
      service.update(uuidOf(1), { telegramUsername: '@Durov' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(users.save).not.toHaveBeenCalled();
  });

  it('does not conflict with the user being edited', async () => {
    stored.push(activeUser({ telegramUsername: 'durov' }));

    await expect(
      service.update(uuidOf(1), {
        email: 'User@Example.com',
        telegramUsername: '@Durov',
        role: Role.Cascade,
      }),
    ).resolves.toMatchObject({
      email: 'user@example.com',
      telegramUsername: 'durov',
      role: Role.Cascade,
    });
  });

  it('ignores an identifier parked on an unfinished registration', async () => {
    stored.push(activeUser(), {
      id: uuidOf(2),
      email: 'abandoned@example.com',
      status: UserStatus.PendingTwoFactor,
    });

    await expect(
      service.update(uuidOf(1), { email: 'abandoned@example.com' }),
    ).resolves.toMatchObject({ email: 'abandoned@example.com' });
  });

  it('refuses to clear the email', async () => {
    stored.push(activeUser({ telegramUsername: 'durov' }));

    await expect(
      service.update(uuidOf(1), { email: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update(uuidOf(1), { email: '   ' })).rejects.toThrow(
      /cannot be cleared/i,
    );
    expect(users.save).not.toHaveBeenCalled();
  });

  it('refuses to clear the telegram username', async () => {
    stored.push(activeUser({ telegramUsername: 'durov' }));

    await expect(
      service.update(uuidOf(1), { telegramUsername: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update(uuidOf(1), { telegramUsername: ' @ ' }),
    ).rejects.toThrow(/cannot be cleared/i);
    expect(users.save).not.toHaveBeenCalled();
  });

  it('refuses to hand out the registration status', async () => {
    stored.push(activeUser());

    await expect(
      service.update(uuidOf(1), { status: UserStatus.PendingTwoFactor }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(users.save).not.toHaveBeenCalled();
  });

  it('re-hashes the password and never stores it in the clear', async () => {
    stored.push(activeUser({ passwordHash: await hash('old-password', 4) }));

    const updated = await service.update(uuidOf(1), {
      password: 'new-password',
    });

    expect(updated.passwordHash).not.toBe('new-password');
    await expect(
      credentials.verifyPassword(updated, 'new-password'),
    ).resolves.toBe(true);
    await expect(
      credentials.verifyPassword(updated, 'old-password'),
    ).resolves.toBe(false);
  });

  it('stamps passwordChangedAt when a password is set', async () => {
    stored.push(activeUser({ passwordChangedAt: null }));
    const before = Date.now();

    const updated = await service.update(uuidOf(1), {
      password: 'new-password',
    });

    expect(updated.passwordChangedAt).toBeInstanceOf(Date);
    expect(updated.passwordChangedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('leaves passwordChangedAt alone when no password is set', async () => {
    stored.push(activeUser({ passwordChangedAt: null }));

    const updated = await service.update(uuidOf(1), {
      telegramUsername: 'durov',
    });

    expect(updated.passwordChangedAt).toBeNull();
  });

  it('does not put the password anywhere but the hash', async () => {
    stored.push(activeUser());

    const updated = await service.update(uuidOf(1), {
      password: 'new-password',
    });

    expect(JSON.stringify(updated)).not.toContain('new-password');
  });
});
