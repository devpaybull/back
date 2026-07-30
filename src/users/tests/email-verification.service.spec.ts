import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { sha256Hex } from '../../common/utils/sha256-hex';
import { AccountMailService } from '../../mail/services/account-mail.service';
import { EmailVerification } from '../entities/email-verification.entity';
import { User } from '../entities/user.entity';
import { EmailVerificationService } from '../services/email-verification.service';
import { UserDirectoryService } from '../services/user-directory.service';
import { UserStatus } from '../types/user-status.enum';
import { createFakeRepository, FakeRepository } from './fake-repository.spec';

describe('EmailVerificationService', () => {
  const env: Record<string, unknown> = { EMAIL_CONFIRMATION_TTL_SECONDS: 900 };

  const mail = { sendEmailConfirmationCode: jest.fn() };

  const unverified = (patch: Partial<User> = {}): Partial<User> => ({
    id: uuidOf(1),
    email: 'user@example.com',
    emailVerified: false,
    telegramUsername: 'durov',
    role: Role.Trader,
    status: UserStatus.Active,
    ...patch,
  });

  const record = (
    patch: Partial<EmailVerification> = {},
  ): Partial<EmailVerification> => ({
    id: 1,
    userId: uuidOf(1),
    email: 'user@example.com',
    codeHash: sha256Hex('123456'),
    failedAttempts: 0,
    expiresAt: new Date(Date.now() + 900000),
    ...patch,
  });

  let stored: Partial<User>[];
  let pending: Partial<EmailVerification>[];
  let users: FakeRepository;
  let verifications: FakeRepository;
  let service: EmailVerificationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mail.sendEmailConfirmationCode.mockResolvedValue(true);
    stored = [];
    pending = [];
    users = createFakeRepository(stored);
    verifications = createFakeRepository(pending);

    const module = await Test.createTestingModule({
      providers: [
        EmailVerificationService,
        UserDirectoryService,
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

    service = module.get(EmailVerificationService);
  });

  describe('issuing a code', () => {
    it('mails a six-digit code that expires with the configured lifetime', async () => {
      const before = Date.now();

      await service.issueFor(uuidOf(1), 'user@example.com');

      const [message] = mail.sendEmailConfirmationCode.mock.calls[0] as [
        { to: string; code: string; expiresAt: Date },
      ];

      expect(message.to).toBe('user@example.com');
      expect(message.code).toMatch(/^\d{6}$/);
      expect(message.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + 900000,
      );
    });

    it('stores the hash of the code and nothing else', async () => {
      await service.issueFor(uuidOf(1), 'user@example.com');

      const [message] = mail.sendEmailConfirmationCode.mock.calls[0] as [
        { code: string },
      ];

      expect(pending[0]).toMatchObject({
        userId: uuidOf(1),
        email: 'user@example.com',
        codeHash: sha256Hex(message.code),
        failedAttempts: 0,
      });
    });

    it('leaves one live record per user', async () => {
      pending.push(record({ email: 'first@example.com' }));

      await service.issueFor(uuidOf(1), 'second@example.com');

      expect(pending).toHaveLength(1);
      expect(pending[0].email).toBe('second@example.com');
    });

    it('leaves the records of other users alone', async () => {
      pending.push(
        record({ id: 9, userId: uuidOf(2), email: 'other@example.com' }),
      );

      await service.issueFor(uuidOf(1), 'user@example.com');

      expect(pending.map((one) => one.userId).sort()).toEqual([
        uuidOf(1),
        uuidOf(2),
      ]);
    });
  });

  describe('confirming a code', () => {
    it('rejects an unknown user', async () => {
      pending.push(record());

      await expect(
        service.confirm(uuidOf(404), '123456'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('confirms the address the code was issued for', async () => {
      stored.push(unverified());
      pending.push(record());

      await expect(service.confirm(uuidOf(1), '123456')).resolves.toMatchObject(
        {
          email: 'user@example.com',
          emailVerified: true,
        },
      );
      expect(stored[0].emailVerified).toBe(true);
    });

    it('forgets the record once it has been spent', async () => {
      stored.push(unverified());
      pending.push(record());

      await service.confirm(uuidOf(1), '123456');

      expect(pending).toHaveLength(0);
      await expect(service.confirm(uuidOf(1), '123456')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a wrong code and counts the attempt', async () => {
      stored.push(unverified());
      pending.push(record());

      await expect(service.confirm(uuidOf(1), '000000')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(pending[0].failedAttempts).toBe(1);
      expect(stored[0].emailVerified).toBe(false);
    });

    it('deletes the record on the fifth wrong code and answers alike on the sixth', async () => {
      stored.push(unverified());
      pending.push(record());

      const attempts: Error[] = [];

      for (let attempt = 0; attempt < 6; attempt += 1) {
        attempts.push(
          (await service
            .confirm(uuidOf(1), '000000')
            .catch((error: Error) => error)) as Error,
        );

        if (attempt === 3) expect(pending).toHaveLength(1);
      }

      expect(pending).toHaveLength(0);
      attempts.forEach((error) =>
        expect(error).toBeInstanceOf(UnauthorizedException),
      );
      expect(attempts[5].message).toBe(attempts[0].message);
    });

    it('answers a right code like an unknown one once the record is gone', async () => {
      stored.push(unverified());
      pending.push(record({ failedAttempts: 4 }));

      await expect(service.confirm(uuidOf(1), '000000')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(pending).toHaveLength(0);

      await expect(service.confirm(uuidOf(1), '123456')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(stored[0].emailVerified).toBe(false);
    });

    it('rejects an expired record', async () => {
      stored.push(unverified());
      pending.push(record({ expiresAt: new Date(Date.now() - 1000) }));

      await expect(service.confirm(uuidOf(1), '123456')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(stored[0].emailVerified).toBe(false);
    });

    it('rejects a record whose address is no longer the one on the account', async () => {
      stored.push(unverified({ email: 'replaced@example.com' }));
      pending.push(record({ email: 'user@example.com' }));

      await expect(service.confirm(uuidOf(1), '123456')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(stored[0].emailVerified).toBe(false);
    });

    it('rejects a code belonging to another account', async () => {
      stored.push(unverified());
      pending.push(record({ userId: uuidOf(2) }));

      await expect(service.confirm(uuidOf(1), '123456')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
