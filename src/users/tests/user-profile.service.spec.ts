import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AccountMailService } from '../../mail/services/account-mail.service';
import { EmailVerification } from '../entities/email-verification.entity';
import { User } from '../entities/user.entity';
import { EmailVerificationService } from '../services/email-verification.service';
import { UserDirectoryService } from '../services/user-directory.service';
import { UserProfileService } from '../services/user-profile.service';
import { UserStatus } from '../types/user-status.enum';
import { createFakeRepository, FakeRepository } from './fake-repository.spec';

describe('UserProfileService', () => {
  const env: Record<string, unknown> = { EMAIL_CONFIRMATION_TTL_SECONDS: 900 };

  const mail = { sendEmailConfirmationCode: jest.fn() };

  const mailedCode = (): string => {
    const { calls } = mail.sendEmailConfirmationCode.mock;

    return (calls[calls.length - 1][0] as { code: string }).code;
  };

  const telegramless = (patch: Partial<User> = {}): Partial<User> => ({
    id: uuidOf(1),
    email: 'user@example.com',
    emailVerified: true,
    telegramUsername: null,
    role: Role.Trader,
    status: UserStatus.Active,
    ...patch,
  });

  const identifierless = (patch: Partial<User> = {}): Partial<User> =>
    telegramless({ email: null, emailVerified: false, ...patch });

  let stored: Partial<User>[];
  let pending: Partial<EmailVerification>[];
  let users: FakeRepository;
  let verifications: FakeRepository;
  let service: UserProfileService;
  let emailVerification: EmailVerificationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mail.sendEmailConfirmationCode.mockResolvedValue(true);
    stored = [];
    pending = [];
    users = createFakeRepository(stored);
    verifications = createFakeRepository(pending);

    const module = await Test.createTestingModule({
      providers: [
        UserProfileService,
        UserDirectoryService,
        EmailVerificationService,
        { provide: getRepositoryToken(User), useValue: users },
        {
          provide: getRepositoryToken(EmailVerification),
          useValue: verifications,
        },
        { provide: AccountMailService, useValue: mail },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => env[key] },
        },
      ],
    }).compile();

    service = module.get(UserProfileService);
    emailVerification = module.get(EmailVerificationService);
  });

  it('rejects an unknown user', async () => {
    await expect(
      service.editOwnIdentifiers(uuidOf(404), { telegramUsername: 'durov' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(users.save).not.toHaveBeenCalled();
    expect(mail.sendEmailConfirmationCode).not.toHaveBeenCalled();
  });

  it('changes nothing when nothing was asked for', async () => {
    stored.push(telegramless());

    await expect(
      service.editOwnIdentifiers(uuidOf(1), {}),
    ).resolves.toMatchObject({
      telegramUsername: null,
    });
    expect(users.save).not.toHaveBeenCalled();
    expect(mail.sendEmailConfirmationCode).not.toHaveBeenCalled();
  });

  describe('the telegram username', () => {
    it('adds the username to an account that has none', async () => {
      stored.push(telegramless());

      await expect(
        service.editOwnIdentifiers(uuidOf(1), { telegramUsername: 'durov' }),
      ).resolves.toMatchObject({
        email: 'user@example.com',
        telegramUsername: 'durov',
      });
      expect(mail.sendEmailConfirmationCode).not.toHaveBeenCalled();
    });

    it('normalises the username before saving it', async () => {
      stored.push(telegramless());

      await expect(
        service.editOwnIdentifiers(uuidOf(1), { telegramUsername: ' @Durov ' }),
      ).resolves.toMatchObject({ telegramUsername: 'durov' });
    });

    it('refuses an empty telegram username instead of clearing the field', async () => {
      stored.push(telegramless());

      await expect(
        service.editOwnIdentifiers(uuidOf(1), { telegramUsername: '  ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(users.save).not.toHaveBeenCalled();
    });

    it('refuses to change a username that is already set', async () => {
      stored.push(telegramless({ telegramUsername: 'durov' }));

      await expect(
        service.editOwnIdentifiers(uuidOf(1), { telegramUsername: 'pavel' }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        service.editOwnIdentifiers(uuidOf(1), { telegramUsername: 'pavel' }),
      ).rejects.toThrow(/only be added, never changed/i);
      expect(users.save).not.toHaveBeenCalled();
    });

    it('refuses to re-add the username the account already holds', async () => {
      stored.push(telegramless({ telegramUsername: 'durov' }));

      await expect(
        service.editOwnIdentifiers(uuidOf(1), { telegramUsername: '@Durov' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(users.save).not.toHaveBeenCalled();
    });

    it('refuses a username held by another registered user', async () => {
      stored.push(telegramless(), {
        id: uuidOf(2),
        telegramUsername: 'durov',
        status: UserStatus.Blocked,
      });

      await expect(
        service.editOwnIdentifiers(uuidOf(1), { telegramUsername: '@Durov' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(users.save).not.toHaveBeenCalled();
    });

    it('ignores a username parked on an unfinished registration', async () => {
      stored.push(telegramless(), {
        id: uuidOf(2),
        telegramUsername: 'durov',
        status: UserStatus.PendingTwoFactor,
      });

      await expect(
        service.editOwnIdentifiers(uuidOf(1), { telegramUsername: 'durov' }),
      ).resolves.toMatchObject({ telegramUsername: 'durov' });
    });
  });

  describe('the email address', () => {
    it('writes the address at once, unconfirmed', async () => {
      stored.push(identifierless());

      await expect(
        service.editOwnIdentifiers(uuidOf(1), { email: '  User@Example.COM ' }),
      ).resolves.toMatchObject({
        email: 'user@example.com',
        emailVerified: false,
      });
      expect(stored[0].email).toBe('user@example.com');
    });

    it('mails a six-digit code to the address that was asked for', async () => {
      stored.push(identifierless());

      await service.editOwnIdentifiers(uuidOf(1), {
        email: '  User@Example.COM ',
      });

      expect(mail.sendEmailConfirmationCode).toHaveBeenCalledWith({
        to: 'user@example.com',
        code: expect.stringMatching(/^\d{6}$/),
        expiresAt: expect.any(Date),
      });
    });

    it('keeps one live record, for the address it was issued for', async () => {
      stored.push(identifierless());

      await service.editOwnIdentifiers(uuidOf(1), {
        email: 'user@example.com',
      });

      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        userId: uuidOf(1),
        email: 'user@example.com',
        failedAttempts: 0,
      });
    });

    it('stores only the hash of the code, never the code itself', async () => {
      stored.push(identifierless());

      await service.editOwnIdentifiers(uuidOf(1), {
        email: 'user@example.com',
      });

      expect(pending[0].codeHash).not.toBe(mailedCode());
      expect(JSON.stringify(pending[0])).not.toContain(mailedCode());
    });

    it('lets an unconfirmed address be replaced, and the old code dies with it', async () => {
      stored.push(identifierless());

      await service.editOwnIdentifiers(uuidOf(1), {
        email: 'first@example.com',
      });
      const abandoned = mailedCode();

      await service.editOwnIdentifiers(uuidOf(1), {
        email: 'second@example.com',
      });

      expect(stored[0].email).toBe('second@example.com');
      expect(pending).toHaveLength(1);
      expect(pending[0].email).toBe('second@example.com');
      await expect(
        emailVerification.confirm(uuidOf(1), abandoned),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('refuses to touch an address that is already confirmed', async () => {
      stored.push(telegramless());

      await expect(
        service.editOwnIdentifiers(uuidOf(1), { email: 'second@example.com' }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        service.editOwnIdentifiers(uuidOf(1), { email: 'second@example.com' }),
      ).rejects.toThrow(/administrator/i);
      expect(users.save).not.toHaveBeenCalled();
      expect(mail.sendEmailConfirmationCode).not.toHaveBeenCalled();
    });

    it('refuses an empty email instead of clearing the field', async () => {
      stored.push(identifierless());

      await expect(
        service.editOwnIdentifiers(uuidOf(1), { email: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(users.save).not.toHaveBeenCalled();
    });

    it('refuses an address held by another registered user', async () => {
      stored.push(identifierless(), {
        id: uuidOf(2),
        email: 'taken@example.com',
        status: UserStatus.Suspended,
      });

      await expect(
        service.editOwnIdentifiers(uuidOf(1), { email: ' Taken@Example.com ' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(users.save).not.toHaveBeenCalled();
      expect(mail.sendEmailConfirmationCode).not.toHaveBeenCalled();
    });

    it('ignores an address parked on an unfinished registration', async () => {
      stored.push(identifierless(), {
        id: uuidOf(2),
        email: 'abandoned@example.com',
        status: UserStatus.PendingTwoFactor,
      });

      await expect(
        service.editOwnIdentifiers(uuidOf(1), {
          email: 'abandoned@example.com',
        }),
      ).resolves.toMatchObject({ email: 'abandoned@example.com' });
    });

    it('answers normally when outgoing mail is disabled', async () => {
      mail.sendEmailConfirmationCode.mockResolvedValue(false);
      stored.push(identifierless());

      await expect(
        service.editOwnIdentifiers(uuidOf(1), { email: 'user@example.com' }),
      ).resolves.toMatchObject({ email: 'user@example.com' });
      expect(pending).toHaveLength(1);
    });

    it('answers normally when the transport fails', async () => {
      mail.sendEmailConfirmationCode.mockRejectedValue(
        new Error('smtp is unreachable'),
      );
      stored.push(identifierless());

      await expect(
        service.editOwnIdentifiers(uuidOf(1), { email: 'user@example.com' }),
      ).resolves.toMatchObject({ email: 'user@example.com' });
    });
  });

  describe('both identifiers at once', () => {
    it('does both things in one call', async () => {
      stored.push(identifierless());

      const edited = await service.editOwnIdentifiers(uuidOf(1), {
        email: ' User@Example.COM ',
        telegramUsername: ' @Durov ',
      });

      expect(edited).toMatchObject({
        email: 'user@example.com',
        emailVerified: false,
        telegramUsername: 'durov',
      });
      expect(mail.sendEmailConfirmationCode).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'user@example.com' }),
      );
    });

    it('applies neither identifier when the email is refused', async () => {
      stored.push(identifierless(), {
        id: uuidOf(2),
        email: 'taken@example.com',
        status: UserStatus.Active,
      });

      await expect(
        service.editOwnIdentifiers(uuidOf(1), {
          email: 'taken@example.com',
          telegramUsername: 'durov',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(users.save).not.toHaveBeenCalled();
      expect(stored[0].telegramUsername).toBeNull();
      expect(mail.sendEmailConfirmationCode).not.toHaveBeenCalled();
    });

    it('mails nothing when the username is refused', async () => {
      stored.push(identifierless({ telegramUsername: 'durov' }));

      await expect(
        service.editOwnIdentifiers(uuidOf(1), {
          email: 'user@example.com',
          telegramUsername: 'pavel',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(users.save).not.toHaveBeenCalled();
      expect(stored[0].email).toBeNull();
      expect(mail.sendEmailConfirmationCode).not.toHaveBeenCalled();
    });
  });
});
