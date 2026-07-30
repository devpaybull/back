import {
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindOperator, IsNull } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { TokenType } from '../../common/types/token';
import { sha256Hex } from '../../common/utils/sha256-hex';
import { AccountMailService } from '../../mail/services/account-mail.service';
import { PasswordRecoveryCodeMailInput } from '../../mail/types/mail-message';
import { User } from '../../users/entities/user.entity';
import { UserAdministrationService } from '../../users/services/user-administration.service';
import { UserCredentialsService } from '../../users/services/user-credentials.service';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { UserStatus } from '../../users/types/user-status.enum';
import { PasswordReset } from '../entities/password-reset.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { PasswordService } from '../services/password.service';
import { SessionService } from '../services/session.service';

const ACCESS_SECRET = 'access-secret-that-is-long-enough-here';
const REFRESH_SECRET = 'refresh-secret-that-is-long-enough-here';

const ENV: Record<string, unknown> = {
  JWT_ACCESS_SECRET: ACCESS_SECRET,
  JWT_REFRESH_SECRET: REFRESH_SECRET,
  JWT_ACCESS_TTL_SECONDS: 900,
  JWT_REFRESH_TTL_SECONDS: 2592000,
  PASSWORD_RESET_TTL_MINUTES: 15,
};

const satisfies = (
  record: PasswordReset,
  where: Record<string, unknown>,
): boolean =>
  Object.entries(where).every(([field, expected]) => {
    const actual = record[field as keyof PasswordReset];

    return expected instanceof FindOperator
      ? expected.type === 'isNull' && (actual ?? null) === null
      : actual === expected;
  });

describe('PasswordService', () => {
  const activeUser = {
    id: uuidOf(1),
    email: 'user@example.com',
    telegramUsername: null,
    emailVerified: true,
    role: Role.Trader,
    status: UserStatus.Active,
  } as User;

  const refreshTokens = {
    findOne: jest.fn(),
    create: jest.fn((data: Partial<RefreshToken>) => ({ ...data })),
    save: jest.fn(async (token: RefreshToken) => token),
    update: jest.fn(),
  };

  const userAdministration = {
    update: jest.fn(),
  };

  const userCredentials = {
    verifyPassword: jest.fn(),
    verifySecondFactor: jest.fn(),
  };

  const userDirectory = {
    findAuthenticatableById: jest.fn(),
    findAuthenticatableByLogin: jest.fn(),
  };

  const storedResets: PasswordReset[] = [];

  let nextResetId = 1;

  const passwordResets = {
    create: jest.fn((data: Partial<PasswordReset>) => ({ ...data })),
    save: jest.fn(async (reset: PasswordReset) => {
      if (!storedResets.includes(reset)) {
        reset.id = nextResetId++;
        storedResets.push(reset);
      }

      return reset;
    }),
    findOne: jest.fn(
      async ({
        where,
        order,
      }: {
        where: Record<string, unknown>;
        order?: { id: 'ASC' | 'DESC' };
      }) => {
        const found = storedResets.filter((reset) => satisfies(reset, where));

        return (
          (order?.id === 'DESC' ? found[found.length - 1] : found[0]) ?? null
        );
      },
    ),
    delete: jest.fn(async (where: Record<string, unknown>) => {
      storedResets
        .filter((reset) => satisfies(reset, where))
        .forEach((reset) =>
          storedResets.splice(storedResets.indexOf(reset), 1),
        );
    }),
  };

  const mail = {
    sendPasswordRecoveryCode: jest.fn<
      Promise<boolean>,
      [PasswordRecoveryCodeMailInput]
    >(),
  };

  const jwt = new JwtService({});

  let service: PasswordService;
  let sessions: SessionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    storedResets.length = 0;
    nextResetId = 1;
    mail.sendPasswordRecoveryCode.mockResolvedValue(true);

    const module = await Test.createTestingModule({
      providers: [
        PasswordService,
        SessionService,
        { provide: getRepositoryToken(RefreshToken), useValue: refreshTokens },
        {
          provide: getRepositoryToken(PasswordReset),
          useValue: passwordResets,
        },
        { provide: UserAdministrationService, useValue: userAdministration },
        { provide: UserCredentialsService, useValue: userCredentials },
        { provide: UserDirectoryService, useValue: userDirectory },
        { provide: AccountMailService, useValue: mail },
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => ENV[key] },
        },
      ],
    }).compile();

    service = module.get(PasswordService);
    sessions = module.get(SessionService);
  });

  describe('changePassword', () => {
    const change = {
      currentPassword: 'password123',
      newPassword: 'newpassword123',
    };

    it('refuses a wrong current password and changes nothing', async () => {
      userDirectory.findAuthenticatableById.mockResolvedValue(activeUser);
      userCredentials.verifyPassword.mockResolvedValue(false);

      await expect(
        service.changePassword(uuidOf(1), change),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(userAdministration.update).not.toHaveBeenCalled();
      expect(refreshTokens.update).not.toHaveBeenCalled();
      expect(refreshTokens.save).not.toHaveBeenCalled();
    });

    it('refuses an account that is no longer authenticatable', async () => {
      userDirectory.findAuthenticatableById.mockResolvedValue(null);

      await expect(
        service.changePassword(uuidOf(1), change),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(userCredentials.verifyPassword).not.toHaveBeenCalled();
    });

    it('revokes every session and hands the caller a usable new pair', async () => {
      userDirectory.findAuthenticatableById.mockResolvedValue(activeUser);
      userCredentials.verifyPassword.mockResolvedValue(true);
      userAdministration.update.mockResolvedValue(activeUser);

      const session = await service.changePassword(uuidOf(1), change);

      expect(userAdministration.update).toHaveBeenCalledWith(uuidOf(1), {
        password: 'newpassword123',
      });
      expect(refreshTokens.update).toHaveBeenCalledWith(
        { userId: uuidOf(1), revokedAt: IsNull() },
        { revokedAt: expect.any(Date) },
      );
      expect(
        jwt.verify(session.accessToken, { secret: ACCESS_SECRET }),
      ).toMatchObject({
        sub: uuidOf(1),
        login: 'user@example.com',
        role: Role.Trader,
        type: TokenType.Access,
      });
      expect(
        jwt.verify(session.refreshToken, { secret: REFRESH_SECRET }),
      ).toMatchObject({ sub: uuidOf(1), type: TokenType.Refresh });
      expect(refreshTokens.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: uuidOf(1),
          tokenHash: sha256Hex(session.refreshToken),
        }),
      );
    });

    it('stores the new session after the revocation, so it survives it', async () => {
      userDirectory.findAuthenticatableById.mockResolvedValue(activeUser);
      userCredentials.verifyPassword.mockResolvedValue(true);
      userAdministration.update.mockResolvedValue(activeUser);

      await service.changePassword(uuidOf(1), change);

      expect(refreshTokens.update.mock.invocationCallOrder[0]).toBeLessThan(
        refreshTokens.save.mock.invocationCallOrder[0],
      );
    });
  });

  describe('password recovery', () => {
    const recoverable = {
      id: uuidOf(5),
      email: 'lost@example.com',
      telegramUsername: null,
      emailVerified: true,
      role: Role.Trader,
      status: UserStatus.Active,
    } as User;

    const withoutEmail = {
      id: uuidOf(6),
      email: null,
      telegramUsername: 'durov',
      emailVerified: false,
      role: Role.Merchant,
      status: UserStatus.Active,
    } as User;

    const unverified = {
      id: uuidOf(7),
      email: 'typo@example.com',
      telegramUsername: null,
      emailVerified: false,
      role: Role.Trader,
      status: UserStatus.Active,
    } as User;

    const sentRecovery = (call = 0): PasswordRecoveryCodeMailInput =>
      mail.sendPasswordRecoveryCode.mock.calls[call][0];

    const requestRecovery = async (): Promise<string> => {
      userDirectory.findAuthenticatableByLogin.mockResolvedValue(recoverable);

      await service.forgotPassword({ login: 'lost@example.com' });

      return sentRecovery(mail.sendPasswordRecoveryCode.mock.calls.length - 1)
        .code;
    };

    const anyCodeBut = (code: string): string =>
      code === '000000' ? '111111' : '000000';

    const reset = (code: string, newPassword = 'newpassword123') =>
      service.resetPassword({
        login: 'lost@example.com',
        code,
        newPassword,
      });

    beforeEach(() => {
      userAdministration.update.mockResolvedValue(recoverable);
    });

    it('creates nothing for an unknown login', async () => {
      userDirectory.findAuthenticatableByLogin.mockResolvedValue(null);

      await expect(
        service.forgotPassword({ login: 'nobody@example.com' }),
      ).resolves.toBeUndefined();
      expect(passwordResets.save).not.toHaveBeenCalled();
      expect(mail.sendPasswordRecoveryCode).not.toHaveBeenCalled();
    });

    it('creates nothing for an account that has no email', async () => {
      userDirectory.findAuthenticatableByLogin.mockResolvedValue(withoutEmail);

      await expect(
        service.forgotPassword({ login: '@durov' }),
      ).resolves.toBeUndefined();
      expect(passwordResets.save).not.toHaveBeenCalled();
      expect(mail.sendPasswordRecoveryCode).not.toHaveBeenCalled();
    });

    it('creates nothing for an address that was never verified', async () => {
      userDirectory.findAuthenticatableByLogin.mockResolvedValue(unverified);

      await expect(
        service.forgotPassword({ login: 'typo@example.com' }),
      ).resolves.toBeUndefined();
      expect(passwordResets.save).not.toHaveBeenCalled();
      expect(mail.sendPasswordRecoveryCode).not.toHaveBeenCalled();
    });

    it('hands the mail module the address, the login, the code and its expiry', async () => {
      const code = await requestRecovery();

      expect(mail.sendPasswordRecoveryCode).toHaveBeenCalledTimes(1);
      expect(sentRecovery()).toEqual({
        to: 'lost@example.com',
        login: 'lost@example.com',
        code,
        expiresAt: storedResets[0].expiresAt,
      });
      expect(code).toMatch(/^\d{6}$/);
    });

    it('stores only the hash of the code', async () => {
      const code = await requestRecovery();
      const [stored] = storedResets;

      expect(stored.codeHash).toBe(sha256Hex(code));
      expect(JSON.stringify(stored)).not.toContain(code);
    });

    it('still answers when the message cannot be sent', async () => {
      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      userDirectory.findAuthenticatableByLogin.mockResolvedValue(recoverable);
      mail.sendPasswordRecoveryCode.mockRejectedValueOnce(
        new Error('smtp is down'),
      );

      await expect(
        service.forgotPassword({ login: 'lost@example.com' }),
      ).resolves.toBeUndefined();
      expect(storedResets).toHaveLength(1);
      expect(logged).toHaveBeenCalled();

      logged.mockRestore();
    });

    it('still answers when the mail module reports no delivery', async () => {
      userDirectory.findAuthenticatableByLogin.mockResolvedValue(recoverable);
      mail.sendPasswordRecoveryCode.mockResolvedValueOnce(false);

      await expect(
        service.forgotPassword({ login: 'lost@example.com' }),
      ).resolves.toBeUndefined();
      expect(storedResets).toHaveLength(1);
    });

    it('resets the password and marks the record used', async () => {
      const code = await requestRecovery();

      await reset(code);

      expect(userAdministration.update).toHaveBeenCalledWith(uuidOf(5), {
        password: 'newpassword123',
      });
      expect(storedResets[0].usedAt).toBeInstanceOf(Date);
    });

    it('revokes every session of the account it reopens', async () => {
      const code = await requestRecovery();

      await reset(code);

      expect(refreshTokens.update).toHaveBeenCalledWith(
        { userId: uuidOf(5), revokedAt: IsNull() },
        { revokedAt: expect.any(Date) },
      );
    });

    it('leaves the old password unusable', async () => {
      let currentPassword = 'password123';

      userAdministration.update.mockImplementation(
        (_id: number, changes: { password: string }) => {
          currentPassword = changes.password;

          return Promise.resolve(recoverable);
        },
      );
      userCredentials.verifyPassword.mockImplementation(
        (_user: User, password: string) =>
          Promise.resolve(password === currentPassword),
      );
      userCredentials.verifySecondFactor.mockResolvedValue(true);

      const code = await requestRecovery();

      await reset(code);

      userDirectory.findAuthenticatableByLogin.mockResolvedValue(recoverable);

      await expect(
        sessions.login({
          login: 'lost@example.com',
          password: 'password123',
          totp: '123456',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        sessions.login({
          login: 'lost@example.com',
          password: 'newpassword123',
          totp: '123456',
        }),
      ).resolves.toMatchObject({ accessToken: expect.any(String) });

      userAdministration.update.mockReset();
      userCredentials.verifyPassword.mockReset();
    });

    it('refuses a login that has never asked for recovery', async () => {
      userDirectory.findAuthenticatableByLogin.mockResolvedValue(recoverable);

      await expect(reset('123456')).rejects.toBeInstanceOf(BadRequestException);
      expect(userAdministration.update).not.toHaveBeenCalled();
    });

    it('refuses an unknown login', async () => {
      await requestRecovery();
      userDirectory.findAuthenticatableByLogin.mockResolvedValue(null);

      await expect(reset('123456')).rejects.toBeInstanceOf(BadRequestException);
      expect(userAdministration.update).not.toHaveBeenCalled();
    });

    it('refuses a wrong code', async () => {
      const code = await requestRecovery();

      await expect(reset(anyCodeBut(code))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(userAdministration.update).not.toHaveBeenCalled();
      expect(storedResets[0].usedAt).toBeUndefined();
    });

    it('refuses a record that was already used', async () => {
      const code = await requestRecovery();

      await reset(code);
      userAdministration.update.mockClear();

      await expect(reset(code, 'anotherpassword123')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(userAdministration.update).not.toHaveBeenCalled();
    });

    it('refuses a record that has expired', async () => {
      const code = await requestRecovery();

      storedResets[0].expiresAt = new Date(Date.now() - 1000);

      await expect(reset(code)).rejects.toBeInstanceOf(BadRequestException);
      expect(userAdministration.update).not.toHaveBeenCalled();
    });

    it('counts a wrong code against the record without spending it', async () => {
      const code = await requestRecovery();

      await expect(reset(anyCodeBut(code))).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(storedResets[0].failedAttempts).toBe(1);

      await expect(reset(code)).resolves.toBeUndefined();
    });

    it('spends the record after five wrong codes, right one included', async () => {
      const code = await requestRecovery();

      for (let attempt = 0; attempt < 5; attempt++) {
        await expect(reset(anyCodeBut(code))).rejects.toBeInstanceOf(
          BadRequestException,
        );
      }

      expect(storedResets[0].failedAttempts).toBe(5);

      await expect(reset(code)).rejects.toBeInstanceOf(BadRequestException);
      expect(userAdministration.update).not.toHaveBeenCalled();
      expect(storedResets[0].failedAttempts).toBe(5);
    });

    it('answers a spent record exactly like an unknown one', async () => {
      const code = await requestRecovery();

      for (let attempt = 0; attempt < 5; attempt++) {
        await reset(anyCodeBut(code)).catch(() => undefined);
      }

      const spent = await reset(code).catch((error: Error) => error);

      storedResets.length = 0;

      const unknown = await reset(code).catch((error: Error) => error);

      expect(spent).toBeInstanceOf(BadRequestException);
      expect((spent as Error).message).toBe((unknown as Error).message);
    });

    it('starts a fresh request with a clean count', async () => {
      const superseded = await requestRecovery();

      await expect(reset(anyCodeBut(superseded))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(storedResets[0].failedAttempts).toBe(1);

      const code = await requestRecovery();

      expect(storedResets[0].failedAttempts).toBe(0);
      await expect(reset(code)).resolves.toBeUndefined();
    });

    it('expires the record PASSWORD_RESET_TTL_MINUTES from now', async () => {
      const before = Date.now();

      await requestRecovery();

      const { expiresAt } = storedResets[0];

      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 15 * 60000);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(
        Date.now() + 15 * 60000 + 1000,
      );
    });

    it('lets only the newest request through', async () => {
      const superseded = await requestRecovery();
      const newest = await requestRecovery();

      expect(passwordResets.delete).toHaveBeenCalledWith({
        userId: uuidOf(5),
        usedAt: IsNull(),
      });
      expect(storedResets).toHaveLength(1);

      await expect(reset(superseded)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(reset(newest)).resolves.toBeUndefined();
    });

    it('refuses a code that belongs to another account', async () => {
      const code = await requestRecovery();

      userDirectory.findAuthenticatableByLogin.mockResolvedValue(withoutEmail);

      await expect(
        service.resetPassword({
          login: '@durov',
          code,
          newPassword: 'newpassword123',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(userAdministration.update).not.toHaveBeenCalled();
    });
  });
});
