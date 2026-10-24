import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { FindOperator, IsNull, Not } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { LoginFootprintService } from '../services/login-footprint.service';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { TokenType } from '../../common/types/token';
import { sha256Hex } from '../../common/utils/sha256-hex';
import { User } from '../../users/entities/user.entity';
import { UserCredentialsService } from '../../users/services/user-credentials.service';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { UserStatus } from '../../users/types/user-status.enum';
import { RefreshToken } from '../entities/refresh-token.entity';
import { SessionService } from '../services/session.service';

const ACCESS_SECRET = 'access-secret-that-is-long-enough-here';
const REFRESH_SECRET = 'refresh-secret-that-is-long-enough-here';

const STORED_SESSION_ID = 42;

const ENV: Record<string, unknown> = {
  JWT_ACCESS_SECRET: ACCESS_SECRET,
  JWT_REFRESH_SECRET: REFRESH_SECRET,
  JWT_ACCESS_TTL_SECONDS: 900,
  JWT_REFRESH_TTL_SECONDS: 2592000,
};

const footprints = { record: jest.fn() };

const context = {
  ip: '203.0.113.7',
  userAgent: 'agent/1.0',
  fingerprint: 'fp-1',
};

describe('SessionService', () => {
  const activeUser = {
    id: uuidOf(1),
    email: 'user@example.com',
    telegramUsername: null,
    role: Role.Trader,
    status: UserStatus.Active,
  } as User;

  const telegramUser = {
    id: uuidOf(2),
    email: null,
    telegramUsername: 'durov',
    role: Role.Merchant,
    status: UserStatus.Active,
  } as User;

  const suspendedUser = {
    id: uuidOf(3),
    email: 'suspended@example.com',
    telegramUsername: null,
    role: Role.Trader,
    status: UserStatus.Suspended,
  } as User;

  const refreshTokens = {
    findOne: jest.fn(),
    create: jest.fn((data: Partial<RefreshToken>) => ({ ...data })),
    save: jest.fn(async (token: RefreshToken) => ({
      ...token,
      id: token.id ?? STORED_SESSION_ID,
    })),
    update: jest.fn(),
  };

  const audit = { record: jest.fn() };

  const manager = { getRepository: jest.fn(() => refreshTokens) };

  const dataSource = {
    transaction: jest.fn(async (work: (m: typeof manager) => unknown) =>
      work(manager),
    ),
  };

  const userCredentials = {
    verifyPassword: jest.fn(),
    verifySecondFactor: jest.fn(),
  };

  const userDirectory = {
    findAuthenticatableById: jest.fn(),
    findAuthenticatableByLogin: jest.fn(),
  };

  const jwt = new JwtService({});

  let service: SessionService;

  const isLive = async (sessionId: number): Promise<boolean> =>
    (await service.findLiveSession(sessionId)) !== null;

  beforeEach(async () => {
    jest.clearAllMocks();
    refreshTokens.update.mockResolvedValue({ affected: 1 });

    const module = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: getRepositoryToken(RefreshToken), useValue: refreshTokens },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: AuditService, useValue: audit },
        { provide: LoginFootprintService, useValue: footprints },
        { provide: UserCredentialsService, useValue: userCredentials },
        { provide: UserDirectoryService, useValue: userDirectory },
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => ENV[key] },
        },
      ],
    }).compile();

    service = module.get(SessionService);
  });

  describe('login', () => {
    const credentials = {
      login: 'user@example.com',
      password: 'password123',
      totp: '123456',
    };

    it('rejects an unknown, blocked or not yet activated account', async () => {
      userDirectory.findAuthenticatableByLogin.mockResolvedValue(null);

      await expect(service.login(credentials)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('names the login, not the email, in the refusal', async () => {
      userDirectory.findAuthenticatableByLogin.mockResolvedValue(null);

      await expect(service.login(credentials)).rejects.toThrow(
        'Invalid login, password or one-time code',
      );
    });

    it('rejects a wrong password before checking the second factor', async () => {
      userDirectory.findAuthenticatableByLogin.mockResolvedValue(activeUser);
      userCredentials.verifyPassword.mockResolvedValue(false);

      await expect(service.login(credentials)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(userCredentials.verifySecondFactor).not.toHaveBeenCalled();
    });

    it('rejects a valid password without a valid second factor', async () => {
      userDirectory.findAuthenticatableByLogin.mockResolvedValue(activeUser);
      userCredentials.verifyPassword.mockResolvedValue(true);
      userCredentials.verifySecondFactor.mockResolvedValue(false);

      await expect(service.login(credentials)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(refreshTokens.save).not.toHaveBeenCalled();
    });

    it('answers an unknown login and a wrong second factor alike', async () => {
      userDirectory.findAuthenticatableByLogin.mockResolvedValue(null);

      const unknown = await service.login(credentials).catch((e: Error) => e);

      userDirectory.findAuthenticatableByLogin.mockResolvedValue(activeUser);
      userCredentials.verifyPassword.mockResolvedValue(true);
      userCredentials.verifySecondFactor.mockResolvedValue(false);

      const wrongFactor = await service
        .login(credentials)
        .catch((e: Error) => e);

      expect((unknown as Error).message).toBe((wrongFactor as Error).message);
    });

    it('records the login footprint of the account that signed in', async () => {
      userDirectory.findAuthenticatableByLogin.mockResolvedValue(activeUser);
      userCredentials.verifyPassword.mockResolvedValue(true);
      userCredentials.verifySecondFactor.mockResolvedValue(true);

      await service.login(credentials, context);

      expect(footprints.record).toHaveBeenCalledWith(uuidOf(1), context);
    });

    it('records nothing for a refused login', async () => {
      userDirectory.findAuthenticatableByLogin.mockResolvedValue(activeUser);
      userCredentials.verifyPassword.mockResolvedValue(false);

      await expect(service.login(credentials, context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(footprints.record).not.toHaveBeenCalled();
    });

    it('issues a session and stores only the hash of the refresh token', async () => {
      userDirectory.findAuthenticatableByLogin.mockResolvedValue(activeUser);
      userCredentials.verifyPassword.mockResolvedValue(true);
      userCredentials.verifySecondFactor.mockResolvedValue(true);

      const session = await service.login(credentials);

      expect(userDirectory.findAuthenticatableByLogin).toHaveBeenCalledWith(
        'user@example.com',
      );
      expect(userCredentials.verifySecondFactor).toHaveBeenCalledWith(
        activeUser,
        {
          totp: '123456',
          backupCode: undefined,
        },
      );
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

    it('logs in an account that was invited by telegram username', async () => {
      userDirectory.findAuthenticatableByLogin.mockResolvedValue(telegramUser);
      userCredentials.verifyPassword.mockResolvedValue(true);
      userCredentials.verifySecondFactor.mockResolvedValue(true);

      const session = await service.login({ ...credentials, login: '@Durov' });

      expect(userDirectory.findAuthenticatableByLogin).toHaveBeenCalledWith(
        '@Durov',
      );
      expect(
        jwt.verify(session.accessToken, { secret: ACCESS_SECRET }),
      ).toMatchObject({ sub: uuidOf(2), login: 'durov', role: Role.Merchant });
    });

    it('lets a suspended account log in', async () => {
      userDirectory.findAuthenticatableByLogin.mockResolvedValue(suspendedUser);
      userCredentials.verifyPassword.mockResolvedValue(true);
      userCredentials.verifySecondFactor.mockResolvedValue(true);

      const session = await service.login({
        ...credentials,
        login: 'suspended@example.com',
      });

      expect(
        jwt.verify(session.accessToken, { secret: ACCESS_SECRET }),
      ).toMatchObject({ sub: uuidOf(3), login: 'suspended@example.com' });
    });

    it('passes a backup code through as the second factor', async () => {
      userDirectory.findAuthenticatableByLogin.mockResolvedValue(activeUser);
      userCredentials.verifyPassword.mockResolvedValue(true);
      userCredentials.verifySecondFactor.mockResolvedValue(true);

      await service.login({
        login: 'user@example.com',
        password: 'password123',
        backupCode: 'AAAAA-BBBBB',
      });

      expect(userCredentials.verifySecondFactor).toHaveBeenCalledWith(
        activeUser,
        {
          totp: undefined,
          backupCode: 'AAAAA-BBBBB',
        },
      );
    });
  });

  describe('refresh', () => {
    const issue = () =>
      jwt.sign(
        { sub: uuidOf(1), jti: 'jti-1', type: TokenType.Refresh },
        { secret: REFRESH_SECRET, expiresIn: 3600 },
      );

    it('rejects a token that was never issued', async () => {
      refreshTokens.findOne.mockResolvedValue(null);

      await expect(service.refresh(issue())).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a token that was already rotated out', async () => {
      refreshTokens.findOne.mockResolvedValue({
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      });

      await expect(service.refresh(issue())).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a token signed with another secret', async () => {
      const foreign = jwt.sign(
        { sub: uuidOf(1), type: TokenType.Refresh },
        { secret: ACCESS_SECRET },
      );

      await expect(service.refresh(foreign)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a token of another type', async () => {
      const wrongType = jwt.sign(
        { sub: uuidOf(1), type: TokenType.Access },
        { secret: REFRESH_SECRET },
      );

      await expect(service.refresh(wrongType)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(refreshTokens.findOne).not.toHaveBeenCalled();
    });

    it('revokes the old token and issues a new pair', async () => {
      refreshTokens.findOne.mockResolvedValue({
        id: 7,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 3600_000),
      });
      userDirectory.findAuthenticatableById.mockResolvedValue(activeUser);

      const previous = issue();
      const session = await service.refresh(previous);

      expect(refreshTokens.update).toHaveBeenCalledWith(
        { id: 7, revokedAt: IsNull() },
        { revokedAt: expect.any(Date) },
      );
      expect(session.refreshToken).not.toBe(previous);
      expect(refreshTokens.save).toHaveBeenCalledWith(
        expect.objectContaining({ tokenHash: sha256Hex(session.refreshToken) }),
      );
    });

    it('lets only one of two concurrent refreshes with one cookie through', async () => {
      refreshTokens.findOne.mockResolvedValue({
        id: 7,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 3600_000),
      });
      userDirectory.findAuthenticatableById.mockResolvedValue(activeUser);
      let revoked = false;
      refreshTokens.update.mockImplementation(async () => {
        const affected = revoked ? 0 : 1;
        revoked = true;

        return { affected };
      });
      const cookie = issue();

      const results = await Promise.allSettled([
        service.refresh(cookie),
        service.refresh(cookie),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(
        (
          results.find(
            (result) => result.status === 'rejected',
          ) as PromiseRejectedResult
        ).reason,
      ).toBeInstanceOf(UnauthorizedException);
      expect(refreshTokens.save).toHaveBeenCalledTimes(1);
    });

    it('rejects the refresh token of a blocked account', async () => {
      refreshTokens.findOne.mockResolvedValue({
        revokedAt: null,
        expiresAt: new Date(Date.now() + 3600_000),
      });
      userDirectory.findAuthenticatableById.mockResolvedValue(null);

      await expect(service.refresh(issue())).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('records no footprint, a rotation is not a sign-in', async () => {
      refreshTokens.findOne.mockResolvedValue({
        revokedAt: null,
        expiresAt: new Date(Date.now() + 3600_000),
      });
      userDirectory.findAuthenticatableById.mockResolvedValue(activeUser);

      await service.refresh(issue());

      expect(footprints.record).not.toHaveBeenCalled();
    });

    it('keeps the superadmin a login-link session was opened by across the rotation', async () => {
      refreshTokens.findOne.mockResolvedValue({
        id: 7,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 3600_000),
        impersonatedByUserId: uuidOf(5),
      });
      userDirectory.findAuthenticatableById.mockResolvedValue(activeUser);

      await service.refresh(issue());

      expect(refreshTokens.save).toHaveBeenCalledWith(
        expect.objectContaining({ impersonatedByUserId: uuidOf(5) }),
      );
    });

    it('rotates an ordinary session into an ordinary one', async () => {
      refreshTokens.findOne.mockResolvedValue({
        id: 7,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 3600_000),
        impersonatedByUserId: null,
      });
      userDirectory.findAuthenticatableById.mockResolvedValue(activeUser);

      await service.refresh(issue());

      expect(refreshTokens.save).toHaveBeenCalledWith(
        expect.objectContaining({ impersonatedByUserId: null }),
      );
    });

    it('still refreshes a suspended account', async () => {
      refreshTokens.findOne.mockResolvedValue({
        revokedAt: null,
        expiresAt: new Date(Date.now() + 3600_000),
      });
      userDirectory.findAuthenticatableById.mockResolvedValue(suspendedUser);

      const session = await service.refresh(issue());

      expect(
        jwt.verify(session.accessToken, { secret: ACCESS_SECRET }),
      ).toMatchObject({ sub: uuidOf(3) });
    });
  });

  describe('revokeAllSessionsAudited', () => {
    it('revokes the sessions and writes the audit row in one transaction', async () => {
      await service.revokeAllSessionsAudited(uuidOf(5), uuidOf(1));

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(refreshTokens.update).toHaveBeenCalledWith(
        { userId: uuidOf(5), revokedAt: IsNull() },
        { revokedAt: expect.any(Date) },
      );
      expect(audit.record).toHaveBeenCalledWith(
        {
          actorUserId: uuidOf(1),
          targetUserId: uuidOf(5),
          action: 'user.sessions_revoked',
        },
        manager,
      );
    });

    it('fails as a whole when the audit row cannot be written', async () => {
      audit.record.mockRejectedValueOnce(new Error('audit down'));

      await expect(
        service.revokeAllSessionsAudited(uuidOf(5), uuidOf(1)),
      ).rejects.toThrow('audit down');
    });
  });

  describe('logout', () => {
    it('revokes the stored refresh token', async () => {
      await service.logout('some-token');

      expect(refreshTokens.update).toHaveBeenCalledWith(
        expect.objectContaining({ tokenHash: sha256Hex('some-token') }),
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });

    it('does nothing when the cookie was already gone', async () => {
      await service.logout(undefined);

      expect(refreshTokens.update).not.toHaveBeenCalled();
    });
  });

  describe('issueSession', () => {
    it('signs the access token with the login, never with the email alone', async () => {
      const session = await service.issueSession(telegramUser);

      expect(
        jwt.verify(session.accessToken, { secret: ACCESS_SECRET }),
      ).toMatchObject({
        sub: uuidOf(2),
        login: 'durov',
        role: Role.Merchant,
        type: TokenType.Access,
      });
    });

    it('signs the telegram username as the login when the account holds both', async () => {
      const session = await service.issueSession({
        ...telegramUser,
        email: 'durov@example.com',
      } as User);

      expect(
        jwt.verify(session.accessToken, { secret: ACCESS_SECRET }),
      ).toMatchObject({ sub: uuidOf(2), login: 'durov' });
    });

    it('signs the email as the login when there is no telegram username', async () => {
      const session = await service.issueSession(activeUser);

      expect(
        jwt.verify(session.accessToken, { secret: ACCESS_SECRET }),
      ).toMatchObject({ sub: uuidOf(1), login: 'user@example.com' });
    });

    it('stores the refresh token with the configured lifetime', async () => {
      const before = Date.now();

      const session = await service.issueSession(activeUser);

      expect(session.refreshExpiresIn).toBe(ENV.JWT_REFRESH_TTL_SECONDS);
      expect(session.expiresIn).toBe(ENV.JWT_ACCESS_TTL_SECONDS);
      expect(
        (
          refreshTokens.save.mock.calls[0][0] as RefreshToken
        ).expiresAt.getTime(),
      ).toBeGreaterThanOrEqual(before + 2592000 * 1000);
    });

    it('names the stored session in the access token', async () => {
      const session = await service.issueSession(activeUser);

      expect(
        jwt.verify(session.accessToken, { secret: ACCESS_SECRET }),
      ).toMatchObject({ sid: STORED_SESSION_ID });
    });

    it("opens an ordinary login as nobody else's session", async () => {
      await service.issueSession(activeUser, context);

      expect(refreshTokens.save).toHaveBeenCalledWith(
        expect.objectContaining({ impersonatedByUserId: null }),
      );
    });

    it('records the footprint of an ordinary login', async () => {
      await service.issueSession(activeUser, context);

      expect(footprints.record).toHaveBeenCalledWith(activeUser.id, context);
    });

    it('records no footprint for a session opened by a superadmin, even with a context', async () => {
      await service.issueSession(activeUser, context, uuidOf(5));

      expect(footprints.record).not.toHaveBeenCalled();
    });

    it('tags a session with the superadmin it was opened by', async () => {
      await service.issueSession(activeUser, context, uuidOf(5));

      expect(refreshTokens.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: activeUser.id,
          impersonatedByUserId: uuidOf(5),
        }),
      );
    });

    it('stores the refresh token before signing the access token', async () => {
      await service.issueSession(activeUser);

      expect(refreshTokens.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('findLiveSession, as the guard asks it', () => {
    it('accepts a stored session that was never revoked', async () => {
      refreshTokens.findOne.mockResolvedValue({
        revokedAt: null,
        expiresAt: new Date(Date.now() + 3600_000),
      });

      await expect(isLive(STORED_SESSION_ID)).resolves.toBe(true);
      expect(refreshTokens.findOne).toHaveBeenCalledWith({
        where: { id: STORED_SESSION_ID },
      });
    });

    it('refuses a session a logout revoked', async () => {
      refreshTokens.findOne.mockResolvedValue({
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      });

      await expect(isLive(STORED_SESSION_ID)).resolves.toBe(false);
    });

    it('refuses a session whose refresh token has expired', async () => {
      refreshTokens.findOne.mockResolvedValue({
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(isLive(STORED_SESSION_ID)).resolves.toBe(false);
    });

    it('refuses a session that is not on record at all', async () => {
      refreshTokens.findOne.mockResolvedValue(null);

      await expect(isLive(STORED_SESSION_ID)).resolves.toBe(false);
    });
  });

  describe('findLiveSession', () => {
    it('hands back the superadmin of a live session from the one read', async () => {
      refreshTokens.findOne.mockResolvedValue({
        id: STORED_SESSION_ID,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 3600_000),
        impersonatedByUserId: uuidOf(5),
      });

      await expect(
        service.findLiveSession(STORED_SESSION_ID),
      ).resolves.toMatchObject({ impersonatedByUserId: uuidOf(5) });
      expect(refreshTokens.findOne).toHaveBeenCalledTimes(1);
    });

    it('answers null for a revoked, expired or unknown session', async () => {
      refreshTokens.findOne.mockResolvedValueOnce({
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      });
      refreshTokens.findOne.mockResolvedValueOnce({
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });
      refreshTokens.findOne.mockResolvedValueOnce(null);

      await expect(service.findLiveSession(1)).resolves.toBeNull();
      await expect(service.findLiveSession(2)).resolves.toBeNull();
      await expect(service.findLiveSession(3)).resolves.toBeNull();
    });
  });

  describe('revokeImpersonationSessions', () => {
    it('revokes the live sessions the superadmin opened and only those', async () => {
      const stored = [
        { userId: uuidOf(7), impersonatedByUserId: uuidOf(5), revokedAt: null },
        { userId: uuidOf(8), impersonatedByUserId: uuidOf(5), revokedAt: null },
        { userId: uuidOf(7), impersonatedByUserId: null, revokedAt: null },
        { userId: uuidOf(5), impersonatedByUserId: null, revokedAt: null },
        { userId: uuidOf(9), impersonatedByUserId: uuidOf(6), revokedAt: null },
      ] as {
        userId: string;
        impersonatedByUserId: string | null;
        revokedAt: Date | null;
      }[];

      refreshTokens.update.mockImplementation(
        async (
          criteria: { impersonatedByUserId?: string; revokedAt: unknown },
          patch: { revokedAt: Date },
        ) => {
          stored
            .filter(
              (row) =>
                criteria.impersonatedByUserId !== undefined &&
                row.impersonatedByUserId === criteria.impersonatedByUserId &&
                criteria.revokedAt instanceof FindOperator &&
                row.revokedAt === null,
            )
            .forEach((row) => Object.assign(row, patch));
        },
      );

      await service.revokeImpersonationSessions(uuidOf(5));

      expect(refreshTokens.update).toHaveBeenCalledWith(
        { impersonatedByUserId: uuidOf(5), revokedAt: IsNull() },
        { revokedAt: expect.any(Date) },
      );
      expect(stored.map((row) => row.revokedAt !== null)).toEqual([
        true,
        true,
        false,
        false,
        false,
      ]);
    });

    it('writes through the manager it is given', async () => {
      await service.revokeImpersonationSessions(uuidOf(5), manager as never);

      expect(manager.getRepository).toHaveBeenCalledWith(RefreshToken);
    });
  });

  describe('revokeImpersonatedSessions', () => {
    it('revokes the live link sessions opened into the account and only those', async () => {
      await service.revokeImpersonatedSessions(uuidOf(7));

      expect(refreshTokens.update).toHaveBeenCalledWith(
        {
          userId: uuidOf(7),
          impersonatedByUserId: Not(IsNull()),
          revokedAt: IsNull(),
        },
        { revokedAt: expect.any(Date) },
      );
    });

    it('writes through the manager it is given', async () => {
      await service.revokeImpersonatedSessions(uuidOf(7), manager as never);

      expect(manager.getRepository).toHaveBeenCalledWith(RefreshToken);
    });
  });

  describe('a logout closes the access token too', () => {
    it('leaves the session of the revoked refresh token dead', async () => {
      const stored = {
        id: STORED_SESSION_ID,
        revokedAt: null as Date,
        expiresAt: new Date(Date.now() + 3600_000),
      };
      refreshTokens.findOne.mockResolvedValue(stored);
      refreshTokens.update.mockImplementation(() => {
        stored.revokedAt = new Date();

        return Promise.resolve();
      });

      const session = await service.issueSession(activeUser);
      const { sid } = jwt.verify<{ sid: number }>(session.accessToken, {
        secret: ACCESS_SECRET,
      });

      await expect(isLive(sid)).resolves.toBe(true);

      await service.logout(session.refreshToken);

      await expect(isLive(sid)).resolves.toBe(false);
    });
  });

  describe('revokeAllSessions', () => {
    it('revokes the live tokens of that user and no others', async () => {
      await service.revokeAllSessions(uuidOf(7));

      expect(refreshTokens.update).toHaveBeenCalledWith(
        { userId: uuidOf(7), revokedAt: IsNull() },
        { revokedAt: expect.any(Date) },
      );
    });

    it('spares tokens that were already revoked', async () => {
      const revokedEarlier = new Date('2026-01-01T00:00:00.000Z');
      const stored = [
        { userId: uuidOf(7), revokedAt: null as Date },
        { userId: uuidOf(7), revokedAt: revokedEarlier },
        { userId: uuidOf(8), revokedAt: null as Date },
      ];

      const asksForUnrevoked = (expected: unknown): boolean =>
        expected instanceof FindOperator && expected.type === 'isNull';

      refreshTokens.update.mockImplementation(
        (
          criteria: { userId: string; revokedAt: unknown },
          patch: { revokedAt: Date },
        ): Promise<void> => {
          stored
            .filter(
              (token) =>
                token.userId === criteria.userId &&
                asksForUnrevoked(criteria.revokedAt) &&
                token.revokedAt === null,
            )
            .forEach((token) => Object.assign(token, patch));

          return Promise.resolve();
        },
      );

      await service.revokeAllSessions(uuidOf(7));

      expect(stored[0].revokedAt).toBeInstanceOf(Date);
      expect(stored[1].revokedAt).toBe(revokedEarlier);
      expect(stored[2].revokedAt).toBeNull();
    });

    it('kills every access token of the user at once, through its sid', async () => {
      const stored: RefreshToken[] = [];

      refreshTokens.save.mockImplementation(async (token: RefreshToken) => {
        const row = { ...token, id: stored.length + 1, revokedAt: null };
        stored.push(row as RefreshToken);

        return row;
      });
      refreshTokens.findOne.mockImplementation(
        async ({ where }: { where: { id: number } }) =>
          stored.find((row) => row.id === where.id) ?? null,
      );
      refreshTokens.update.mockImplementation(
        async (criteria: { userId: string }, patch: { revokedAt: Date }) => {
          stored
            .filter((row) => row.userId === criteria.userId && !row.revokedAt)
            .forEach((row) => Object.assign(row, patch));
        },
      );

      const sids = await Promise.all(
        [activeUser, activeUser, telegramUser].map(async (owner) => {
          const issued = await service.issueSession(owner);

          return jwt.verify<{ sid: number }>(issued.accessToken, {
            secret: ACCESS_SECRET,
          }).sid;
        }),
      );

      await service.revokeAllSessions(activeUser.id);

      await expect(isLive(sids[0])).resolves.toBe(false);
      await expect(isLive(sids[1])).resolves.toBe(false);
      await expect(isLive(sids[2])).resolves.toBe(true);
    });
  });
});
