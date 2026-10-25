import {
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { FindOperator, IsNull, LessThan, MoreThan } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { LoginFootprintService } from '../services/login-footprint.service';
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

    if (!(expected instanceof FindOperator)) return actual === expected;

    switch (expected.type) {
      case 'isNull':
        return (actual ?? null) === null;
      case 'lessThan':
        return (actual as number | Date) < (expected.value as number | Date);
      case 'moreThan':
        return (actual as number | Date) > (expected.value as number | Date);
      default:
        throw new Error(`Unsupported operator ${expected.type}`);
    }
  });

const footprints = { record: jest.fn() };

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
    update: jest.fn(
      async (where: Record<string, unknown>, patch: Partial<PasswordReset>) => {
        const matched = storedResets.filter((reset) => satisfies(reset, where));

        matched.forEach((reset) => Object.assign(reset, patch));

        return { affected: matched.length };
      },
    ),
    increment: jest.fn(
      async (
        where: Record<string, unknown>,
        field: 'failedAttempts',
        by: number,
      ) => {
        const matched = storedResets.filter((reset) => satisfies(reset, where));

        matched.forEach((reset) => {
          reset[field] += by;
        });

        return { affected: matched.length };
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

  const audit = { record: jest.fn() };

  const manager = {
    getRepository: jest.fn(() => refreshTokens),
  };

  const dataSource = {
    transaction: jest.fn(async (work: (m: typeof manager) => unknown) =>
      work(manager),
    ),
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
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: AuditService, useValue: audit },
        { provide: LoginFootprintService, useValue: footprints },
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

      expect(userAdministration.update).toHaveBeenCalledWith(
        uuidOf(1),
        { password: 'newpassword123' },
        manager,
      );
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

  describe('issueGeneratedPassword', () => {
    const GENERATED_PASSWORD = /^[a-zA-Z0-9]{12}$/;
    const ACTOR_ID = uuidOf(99);

    it('writes a 12-character letters-and-digits password through the hashing path', async () => {
      userAdministration.update.mockResolvedValue(activeUser);

      const password = await service.issueGeneratedPassword(
        uuidOf(1),
        ACTOR_ID,
      );

      expect(password).toMatch(GENERATED_PASSWORD);
      expect(userAdministration.update).toHaveBeenCalledWith(
        uuidOf(1),
        { password },
        manager,
      );
    });

    it('revokes every session after the password is written', async () => {
      userAdministration.update.mockResolvedValue(activeUser);

      await service.issueGeneratedPassword(uuidOf(1), ACTOR_ID);

      expect(refreshTokens.update).toHaveBeenCalledWith(
        { userId: uuidOf(1), revokedAt: IsNull() },
        { revokedAt: expect.any(Date) },
      );
      expect(
        userAdministration.update.mock.invocationCallOrder[0],
      ).toBeLessThan(refreshTokens.update.mock.invocationCallOrder[0]);
    });

    it('opens no session of its own', async () => {
      userAdministration.update.mockResolvedValue(activeUser);

      await service.issueGeneratedPassword(uuidOf(1), ACTOR_ID);

      expect(refreshTokens.save).not.toHaveBeenCalled();
    });

    it('revokes nothing when the password could not be written', async () => {
      userAdministration.update.mockRejectedValue(new Error('not found'));

      await expect(
        service.issueGeneratedPassword(uuidOf(1), ACTOR_ID),
      ).rejects.toThrow('not found');
      expect(refreshTokens.update).not.toHaveBeenCalled();
    });

    it('draws every character class and never repeats a password', async () => {
      userAdministration.update.mockResolvedValue(activeUser);

      const passwords = await Promise.all(
        Array.from({ length: 200 }, () =>
          service.issueGeneratedPassword(uuidOf(1), ACTOR_ID),
        ),
      );
      const characters = passwords.join('');

      expect(
        passwords.every((password) => GENERATED_PASSWORD.test(password)),
      ).toBe(true);
      expect(new Set(passwords).size).toBe(passwords.length);
      expect(characters).toMatch(/[a-z]/);
      expect(characters).toMatch(/[A-Z]/);
      expect(characters).toMatch(/[0-9]/);
      expect(new Set(characters).size).toBe(62);
    });

    it('writes the password, the revocation and the audit row in one transaction', async () => {
      userAdministration.update.mockResolvedValue(activeUser);

      await service.issueGeneratedPassword(uuidOf(1), ACTOR_ID);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.getRepository).toHaveBeenCalledWith(RefreshToken);
      expect(audit.record).toHaveBeenCalledWith(
        {
          actorUserId: ACTOR_ID,
          targetUserId: uuidOf(1),
          action: 'user.password_generated',
        },
        manager,
      );
    });

    it('keeps the generated password out of the audit row', async () => {
      userAdministration.update.mockResolvedValue(activeUser);

      const password = await service.issueGeneratedPassword(
        uuidOf(1),
        ACTOR_ID,
      );

      expect(JSON.stringify(audit.record.mock.calls)).not.toContain(password);
    });

    it('fails as a whole when the audit row cannot be written', async () => {
      userAdministration.update.mockResolvedValue(activeUser);
      audit.record.mockRejectedValueOnce(new Error('audit down'));

      await expect(
        service.issueGeneratedPassword(uuidOf(1), ACTOR_ID),
      ).rejects.toThrow('audit down');
    });

    it('never logs the password', async () => {
      userAdministration.update.mockResolvedValue(activeUser);
      const logged = [
        jest.spyOn(console, 'log').mockImplementation(() => undefined),
        jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
        jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => undefined),
        jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation(() => undefined),
      ];

      const password = await service.issueGeneratedPassword(
        uuidOf(1),
        ACTOR_ID,
      );

      for (const spy of logged) {
        expect(JSON.stringify(spy.mock.calls)).not.toContain(password);
        spy.mockRestore();
      }
    });
  });

  describe('setPassword', () => {
    it('writes the changes, the revocation and the audit row in one transaction', async () => {
      userAdministration.update.mockResolvedValue(activeUser);

      await service.setPassword(
        uuidOf(1),
        { password: 'a brand new password', role: Role.Merchant },
        uuidOf(99),
      );

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(userAdministration.update).toHaveBeenCalledWith(
        uuidOf(1),
        { password: 'a brand new password', role: Role.Merchant },
        manager,
      );
      expect(refreshTokens.update).toHaveBeenCalledWith(
        { userId: uuidOf(1), revokedAt: IsNull() },
        { revokedAt: expect.any(Date) },
      );
      expect(audit.record).toHaveBeenCalledWith(
        {
          actorUserId: uuidOf(99),
          targetUserId: uuidOf(1),
          action: 'user.password_set',
        },
        manager,
      );
      expect(JSON.stringify(audit.record.mock.calls)).not.toContain(
        'a brand new password',
      );
    });
  });

  describe('no secret reaches a log', () => {
    it('never prints a recovery code to stdout or to the Nest logger', async () => {
      const recoverable = {
        id: uuidOf(5),
        email: 'lost@example.com',
        telegramUsername: null,
        emailVerified: true,
        role: Role.Trader,
        status: UserStatus.Active,
      } as User;
      userDirectory.findAuthenticatableByLogin.mockResolvedValue(recoverable);
      const spies = [
        jest.spyOn(console, 'log').mockImplementation(() => undefined),
        jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
        jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => undefined),
        jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation(() => undefined),
        jest
          .spyOn(Logger.prototype, 'debug')
          .mockImplementation(() => undefined),
        jest
          .spyOn(Logger.prototype, 'verbose')
          .mockImplementation(() => undefined),
      ];

      await service.forgotPassword({ login: 'lost@example.com' });

      const [{ code }] = mail.sendPasswordRecoveryCode.mock.calls[0];

      for (const spy of spies) {
        expect(JSON.stringify(spy.mock.calls)).not.toContain(code);
        spy.mockRestore();
      }
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

      expect(userAdministration.update).toHaveBeenCalledWith(
        uuidOf(5),
        { password: 'newpassword123' },
        manager,
      );
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

    const staleReadOf = () => {
      const snapshot = { ...storedResets[0] };

      passwordResets.findOne.mockImplementationOnce(async () => snapshot);
    };

    it('counts a wrong code with one conditional increment, never by saving a stale count', async () => {
      const code = await requestRecovery();
      passwordResets.save.mockClear();

      await expect(reset(anyCodeBut(code))).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(passwordResets.increment).toHaveBeenCalledWith(
        { id: storedResets[0].id, failedAttempts: LessThan(5) },
        'failedAttempts',
        1,
      );
      expect(passwordResets.save).not.toHaveBeenCalled();
    });

    it('counts both of two wrong guesses that read the same count', async () => {
      const code = await requestRecovery();

      storedResets[0].failedAttempts = 3;
      staleReadOf();
      staleReadOf();

      await reset(anyCodeBut(code)).catch(() => undefined);
      await reset(anyCodeBut(code)).catch(() => undefined);

      expect(storedResets).toHaveLength(1);
      expect(storedResets[0].failedAttempts).toBe(5);
    });

    it('never counts past five, whatever the read said', async () => {
      const code = await requestRecovery();

      staleReadOf();
      storedResets[0].failedAttempts = 5;

      await expect(reset(anyCodeBut(code))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(storedResets[0].failedAttempts).toBe(5);
    });

    it('spends a code once when two right answers race', async () => {
      const code = await requestRecovery();
      staleReadOf();
      staleReadOf();

      await reset(code);
      userAdministration.update.mockClear();

      await expect(reset(code, 'anotherpassword123')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(userAdministration.update).not.toHaveBeenCalled();
    });

    it('refuses the right code once a racing wrong guess spent the last attempt', async () => {
      const code = await requestRecovery();
      staleReadOf();
      storedResets[0].failedAttempts = 5;

      await expect(reset(code)).rejects.toBeInstanceOf(BadRequestException);
      expect(userAdministration.update).not.toHaveBeenCalled();
      expect(storedResets[0].usedAt).toBeUndefined();
    });

    it('spends the record with a conditional update', async () => {
      const code = await requestRecovery();

      await reset(code);

      expect(passwordResets.update).toHaveBeenCalledWith(
        {
          id: storedResets[0].id,
          usedAt: IsNull(),
          failedAttempts: LessThan(5),
          expiresAt: MoreThan(expect.any(Date)),
        },
        { usedAt: expect.any(Date) },
      );
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
