import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { hash } from 'bcryptjs';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { UserBackupCode } from '../entities/user-backup-code.entity';
import { User } from '../entities/user.entity';
import { UserAdministrationService } from '../services/user-administration.service';
import { UserCredentialsService } from '../services/user-credentials.service';
import { UserDirectoryService } from '../services/user-directory.service';
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

  it('does not put the password anywhere but the hash', async () => {
    stored.push(activeUser());

    const updated = await service.update(uuidOf(1), {
      password: 'new-password',
    });

    expect(JSON.stringify(updated)).not.toContain('new-password');
  });
});
