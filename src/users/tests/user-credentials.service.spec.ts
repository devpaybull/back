import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { hash } from 'bcryptjs';
import { generate, generateSecret } from 'otplib';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { sha256Hex } from '../../common/utils/sha256-hex';
import { UserBackupCode } from '../entities/user-backup-code.entity';
import { User } from '../entities/user.entity';
import { UserCredentialsService } from '../services/user-credentials.service';
import { createFakeRepository, FakeRepository } from './fake-repository.spec';

describe('UserCredentialsService', () => {
  const secret = generateSecret();
  const user = { id: uuidOf(1), totpSecret: secret } as User;

  let stored: Partial<UserBackupCode>[];
  let backupCodes: FakeRepository;
  let service: UserCredentialsService;

  beforeEach(async () => {
    stored = [];
    backupCodes = createFakeRepository(stored);

    const module = await Test.createTestingModule({
      providers: [
        UserCredentialsService,
        { provide: getRepositoryToken(UserBackupCode), useValue: backupCodes },
        { provide: getRepositoryToken(User), useValue: {} },
      ],
    }).compile();

    service = module.get(UserCredentialsService);
  });

  describe('passwords', () => {
    it('compares against the stored hash', async () => {
      const holder = { passwordHash: await hash('password123', 4) } as User;

      await expect(service.verifyPassword(holder, 'password123')).resolves.toBe(
        true,
      );
      await expect(service.verifyPassword(holder, 'password124')).resolves.toBe(
        false,
      );
    });

    it('hashes a password into something it is not', async () => {
      const hashed = await service.hashPassword('password123');

      expect(hashed).not.toBe('password123');
      await expect(
        service.verifyPassword({ passwordHash: hashed } as User, 'password123'),
      ).resolves.toBe(true);
    });
  });

  describe('verifyTotp', () => {
    it('treats a secret too short for the algorithm as a wrong code', async () => {
      const shortUser = { id: uuidOf(1), totpSecret: 'AAAA' } as User;

      await expect(service.verifyTotp(shortUser, '123456')).resolves.toBe(
        false,
      );
    });

    it('accepts a code generated from a valid secret', async () => {
      await expect(
        service.verifyTotp(user, await generate({ secret })),
      ).resolves.toBe(true);
    });
  });

  describe('verifySecondFactor', () => {
    it('accepts a current one-time code', async () => {
      await expect(
        service.verifySecondFactor(user, { totp: await generate({ secret }) }),
      ).resolves.toBe(true);
    });

    it('rejects a wrong one-time code', async () => {
      await expect(
        service.verifySecondFactor(user, { totp: '000000' }),
      ).resolves.toBe(false);
    });

    it('accepts a backup code and burns it', async () => {
      const code = {
        id: 1,
        userId: uuidOf(1),
        codeHash: sha256Hex('A1B2C3D4E5'),
        usedAt: null,
      };
      stored.push(code);

      await expect(
        service.verifySecondFactor(user, { backupCode: 'a1b2c-3d4e5' }),
      ).resolves.toBe(true);
      expect(code.usedAt).toBeInstanceOf(Date);
      await expect(
        service.verifySecondFactor(user, { backupCode: 'a1b2c-3d4e5' }),
      ).resolves.toBe(false);
    });

    it('rejects an unknown backup code', async () => {
      await expect(
        service.verifySecondFactor(user, { backupCode: 'A1B2C-3D4E5' }),
      ).resolves.toBe(false);
    });

    it('rejects a login without any second factor', async () => {
      await expect(service.verifySecondFactor(user, {})).resolves.toBe(false);
    });
  });

  describe('backup codes', () => {
    it('issues ten distinct codes in the printed shape', async () => {
      const codes = await service.issueBackupCodes(uuidOf(1));

      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10);
      codes.forEach((code) =>
        expect(code).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/),
      );
    });

    it('stores only hashes of the codes', async () => {
      const codes = await service.issueBackupCodes(uuidOf(1));

      expect(stored.map((code) => code.codeHash)).toContain(
        sha256Hex(codes[0].replace('-', '')),
      );
      stored.forEach((code) => expect(codes).not.toContain(code.codeHash));
    });

    it('replaces whatever the user had before', async () => {
      stored.push({ id: 1, userId: uuidOf(1), codeHash: 'old', usedAt: null });

      await service.issueBackupCodes(uuidOf(1));

      expect(stored.map((code) => code.codeHash)).not.toContain('old');
      expect(stored).toHaveLength(10);
    });

    it('discards every code of one user and leaves the others', async () => {
      stored.push(
        { id: 1, userId: uuidOf(1), codeHash: 'mine', usedAt: null },
        { id: 2, userId: uuidOf(2), codeHash: 'theirs', usedAt: null },
      );

      await service.discardBackupCodes(uuidOf(1));

      expect(backupCodes.delete).toHaveBeenCalledWith({ userId: uuidOf(1) });
      expect(stored.map((code) => code.codeHash)).toEqual(['theirs']);
    });
  });

  describe('spendWithdrawalTotp', () => {
    const LIMITS = { maxFailures: 5, windowMinutes: 15 };
    const NOW = new Date('2026-10-25T12:00:00Z');

    const build = (affected = 1) => {
      const query = {
        update: jest.fn(),
        set: jest.fn(),
        where: jest.fn(),
        andWhere: jest.fn(),
        execute: jest.fn(async () => ({ affected })),
      };
      query.update.mockReturnValue(query);
      query.set.mockReturnValue(query);
      query.where.mockReturnValue(query);
      query.andWhere.mockReturnValue(query);
      const users = {
        createQueryBuilder: jest.fn(() => query),
        update: jest.fn(async () => undefined),
      };
      const credentials = new UserCredentialsService(
        backupCodes as never,
        users as never,
      );

      return { credentials, users, query };
    };

    const holder = (overrides: Partial<User> = {}): User =>
      ({
        id: uuidOf(1),
        totpSecret: secret,
        withdrawalTotpLastStep: null,
        withdrawalTotpFailures: 0,
        withdrawalTotpFailuresSince: null,
        ...overrides,
      }) as User;

    it('accepts a valid code, stores its step and clears the failures', async () => {
      const { credentials, query, users } = build(1);

      await expect(
        credentials.spendWithdrawalTotp(
          holder(),
          await generate({ secret }),
          LIMITS,
          NOW,
        ),
      ).resolves.toBe('accepted');
      expect(query.set).toHaveBeenCalledWith({
        withdrawalTotpLastStep: expect.any(Number),
        withdrawalTotpFailures: 0,
        withdrawalTotpFailuresSince: null,
      });
      expect(query.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('"withdrawalTotpLastStep" < :step'),
        { step: expect.any(Number) },
      );
      expect(users.update).not.toHaveBeenCalled();
    });

    it('refuses and counts a replayed or older step — the conditional update changes nothing', async () => {
      const { credentials, users } = build(0);

      await expect(
        credentials.spendWithdrawalTotp(
          holder({ withdrawalTotpLastStep: 2_000_000_000 }),
          await generate({ secret }),
          LIMITS,
          NOW,
        ),
      ).resolves.toBe('refused');
      expect(users.update).toHaveBeenCalledWith(
        { id: uuidOf(1) },
        { withdrawalTotpFailures: 1, withdrawalTotpFailuresSince: NOW },
      );
    });

    it('counts a wrong code and starts the window at the first failure', async () => {
      const { credentials, users, query } = build();

      await expect(
        credentials.spendWithdrawalTotp(holder(), '000000', LIMITS, NOW),
      ).resolves.toBe('refused');
      expect(query.execute).not.toHaveBeenCalled();
      expect(users.update).toHaveBeenCalledWith(
        { id: uuidOf(1) },
        { withdrawalTotpFailures: 1, withdrawalTotpFailuresSince: NOW },
      );
    });

    it('adds to the failures inside the window', async () => {
      const { credentials, users } = build();

      await credentials.spendWithdrawalTotp(
        holder({
          withdrawalTotpFailures: 3,
          withdrawalTotpFailuresSince: new Date(NOW.getTime() - 60_000),
        }),
        '000000',
        LIMITS,
        NOW,
      );

      expect(users.update).toHaveBeenCalledWith(
        { id: uuidOf(1) },
        { withdrawalTotpFailures: 4 },
      );
    });

    it('locks at the maximum inside the window, before checking the code', async () => {
      const { credentials, users, query } = build();

      await expect(
        credentials.spendWithdrawalTotp(
          holder({
            withdrawalTotpFailures: 5,
            withdrawalTotpFailuresSince: new Date(NOW.getTime() - 60_000),
          }),
          await generate({ secret }),
          LIMITS,
          NOW,
        ),
      ).resolves.toBe('locked');
      expect(query.execute).not.toHaveBeenCalled();
      expect(users.update).not.toHaveBeenCalled();
    });

    it('restarts the count at one once the window has passed', async () => {
      const { credentials, users } = build();

      await expect(
        credentials.spendWithdrawalTotp(
          holder({
            withdrawalTotpFailures: 5,
            withdrawalTotpFailuresSince: new Date(NOW.getTime() - 16 * 60_000),
          }),
          '000000',
          LIMITS,
          NOW,
        ),
      ).resolves.toBe('refused');
      expect(users.update).toHaveBeenCalledWith(
        { id: uuidOf(1) },
        { withdrawalTotpFailures: 1, withdrawalTotpFailuresSince: NOW },
      );
    });
  });
});
