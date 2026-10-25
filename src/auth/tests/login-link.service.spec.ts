import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { FindOperator } from 'typeorm';
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
import { LoginLink } from '../entities/login-link.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { LoginLinkService } from '../services/login-link.service';
import { SessionService } from '../services/session.service';

const ACCESS_SECRET = 'access-secret-that-is-long-enough-here';
const REFRESH_SECRET = 'refresh-secret-that-is-long-enough-here';
const STORED_SESSION_ID = 42;
const MINUTE_IN_MS = 60 * 1000;
const REJECTED = 'Login link is invalid, used or expired';

const matches = (link: LoginLink, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([field, expected]) => {
    const actual = link[field as keyof LoginLink];

    if (!(expected instanceof FindOperator)) return actual === expected;
    if (expected.type === 'isNull') return (actual ?? null) === null;
    if (expected.type === 'moreThan') {
      return (actual as Date) > (expected.value as Date);
    }

    throw new Error(`Unsupported operator ${expected.type}`);
  });

const footprints = { record: jest.fn() };

describe('LoginLinkService', () => {
  const trader = {
    id: uuidOf(7),
    email: 'trader@example.com',
    telegramUsername: null,
    role: Role.Trader,
    status: UserStatus.Active,
  } as User;

  const superadminId = uuidOf(1);

  const superadmin = {
    id: superadminId,
    email: 'root@example.com',
    telegramUsername: null,
    role: Role.Superadmin,
    status: UserStatus.Active,
  } as User;

  let env: Record<string, unknown>;
  let stored: LoginLink[];
  let nextId: number;
  let committed: boolean[];

  const manager = {
    create: jest.fn((_entity: unknown, data: Partial<LoginLink>) => ({
      ...data,
    })),
    save: jest.fn(async (link: LoginLink) => {
      link.id = nextId++;
      stored.push(link);

      return link;
    }),
    delete: jest.fn(
      async (_entity: unknown, where: Record<string, unknown>) => {
        stored = stored.filter((link) => !matches(link, where));
      },
    ),
    query: jest.fn(async () => undefined),
    update: jest.fn(
      async (
        _entity: unknown,
        where: Record<string, unknown>,
        changes: Partial<LoginLink>,
      ) => {
        const hit = stored.filter((link) => matches(link, where));

        hit.forEach((link) => Object.assign(link, changes));

        return { affected: hit.length };
      },
    ),
  };

  const dataSource = {
    transaction: jest.fn(async (work: (m: typeof manager) => unknown) => {
      try {
        const result = await work(manager);
        committed.push(true);

        return result;
      } catch (error) {
        committed.push(false);
        throw error;
      }
    }),
  };

  const links = {
    delete: jest.fn(async (where: Record<string, unknown>) => {
      stored = stored.filter((link) => !matches(link, where));
    }),
    findOne: jest.fn(
      async ({ where }: { where: Record<string, unknown> }) =>
        stored.find((link) => matches(link, where)) ?? null,
    ),
  };

  const audit = { record: jest.fn() };

  const userDirectory = {
    findAuthenticatableById: jest.fn(),
    findAuthenticatableByLogin: jest.fn(),
  };

  const refreshTokens = {
    findOne: jest.fn(),
    create: jest.fn((data: Partial<RefreshToken>) => ({ ...data })),
    save: jest.fn(async (token: RefreshToken) => ({
      ...token,
      id: STORED_SESSION_ID,
    })),
    update: jest.fn(),
  };

  const jwt = new JwtService({});

  let service: LoginLinkService;

  beforeEach(async () => {
    jest.clearAllMocks();
    stored = [];
    nextId = 1;
    committed = [];
    env = {
      JWT_ACCESS_SECRET: ACCESS_SECRET,
      JWT_REFRESH_SECRET: REFRESH_SECRET,
      JWT_ACCESS_TTL_SECONDS: 900,
      JWT_REFRESH_TTL_SECONDS: 2592000,
      LOGIN_LINK_TTL_MINUTES: 15,
      APP_URL: 'https://app.example.com/',
    };
    audit.record.mockResolvedValue({});
    userDirectory.findAuthenticatableById.mockImplementation(
      async (id: string) => (id === superadminId ? superadmin : trader),
    );

    const module = await Test.createTestingModule({
      providers: [
        LoginLinkService,
        SessionService,
        { provide: getRepositoryToken(LoginLink), useValue: links },
        { provide: getRepositoryToken(RefreshToken), useValue: refreshTokens },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: AuditService, useValue: audit },
        { provide: LoginFootprintService, useValue: footprints },
        { provide: UserDirectoryService, useValue: userDirectory },
        { provide: UserCredentialsService, useValue: {} },
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => env[key] },
        },
      ],
    }).compile();

    service = module.get(LoginLinkService);
  });

  describe('invalidateIssuedBy', () => {
    it('deletes the unused links the superadmin issued and nothing else', async () => {
      const otherId = uuidOf(2);
      const make = (over: Partial<LoginLink>): LoginLink =>
        ({ id: nextId++, usedAt: null, ...over }) as LoginLink;
      stored = [
        make({ issuedByUserId: superadminId, userId: uuidOf(7) }),
        make({ issuedByUserId: superadminId, userId: uuidOf(8) }),
        make({
          issuedByUserId: superadminId,
          userId: uuidOf(9),
          usedAt: new Date(),
        }),
        make({ issuedByUserId: otherId, userId: uuidOf(7) }),
      ];

      await service.invalidateIssuedBy(superadminId);

      expect(stored.map((link) => link.issuedByUserId)).toEqual([
        superadminId,
        otherId,
      ]);
      expect(stored[0].usedAt).not.toBeNull();
    });
  });

  describe('issue', () => {
    it('stores only the hash of a high-entropy code', async () => {
      const issued = await service.issue(trader.id, superadminId);

      expect(Buffer.from(issued.code, 'base64url')).toHaveLength(32);
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        userId: trader.id,
        issuedByUserId: superadminId,
        codeHash: sha256Hex(issued.code),
        usedAt: null,
      });
      expect(JSON.stringify(stored)).not.toContain(issued.code);
    });

    it('never hands out the same code twice', async () => {
      const first = await service.issue(trader.id, superadminId);
      const second = await service.issue(uuidOf(8), superadminId);

      expect(first.code).not.toBe(second.code);
    });

    it('expires after LOGIN_LINK_TTL_MINUTES', async () => {
      env.LOGIN_LINK_TTL_MINUTES = 5;
      const before = Date.now();

      const issued = await service.issue(trader.id, superadminId);

      expect(issued.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + 5 * MINUTE_IN_MS,
      );
      expect(issued.expiresAt.getTime()).toBeLessThanOrEqual(
        Date.now() + 5 * MINUTE_IN_MS,
      );
      expect(stored[0].expiresAt).toEqual(issued.expiresAt);
    });

    it('builds the link from APP_URL without doubling the slash', async () => {
      const issued = await service.issue(trader.id, superadminId);

      expect(issued.url).toBe(
        `https://app.example.com/login-link#code=${issued.code}`,
      );
    });

    it('keeps the code out of the query string of the link', async () => {
      const issued = await service.issue(trader.id, superadminId);

      expect(issued.url).not.toContain('?');
      expect(new URL(issued.url as string).search).toBe('');
    });

    it('takes a per-account advisory lock before touching the links', async () => {
      await service.issue(trader.id, superadminId);

      expect(manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [trader.id],
      );
      expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
        manager.delete.mock.invocationCallOrder[0],
      );
      expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
        manager.save.mock.invocationCallOrder[0],
      );
    });

    it('invents no link when APP_URL is empty', async () => {
      env.APP_URL = '';

      const issued = await service.issue(trader.id, superadminId);

      expect(issued.url).toBeNull();
      expect(issued.code).toBeTruthy();
    });

    it('kills the previous unused link of the same account', async () => {
      const first = await service.issue(trader.id, superadminId);
      const second = await service.issue(trader.id, superadminId);

      expect(stored.map((link) => link.codeHash)).toEqual([
        sha256Hex(second.code),
      ]);
      await expect(service.redeem(first.code)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.redeem(second.code)).resolves.toBeDefined();
    });

    it('leaves the links of other accounts and the spent ones alone', async () => {
      const spent = await service.issue(trader.id, superadminId);
      await service.redeem(spent.code);
      const other = await service.issue(uuidOf(8), superadminId);

      await service.issue(trader.id, superadminId);

      expect(stored.map((link) => link.codeHash)).toEqual(
        expect.arrayContaining([sha256Hex(spent.code), sha256Hex(other.code)]),
      );
      expect(stored).toHaveLength(3);
    });

    it('writes the code and its audit row in one transaction', async () => {
      await service.issue(trader.id, superadminId);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        {
          actorUserId: superadminId,
          targetUserId: trader.id,
          action: 'user.login_link_issued',
          metadata: {
            loginLinkId: stored[0].id,
            expiresAt: stored[0].expiresAt.toISOString(),
          },
        },
        manager,
      );
    });

    it('never puts the code into the audit row', async () => {
      const issued = await service.issue(trader.id, superadminId);

      expect(JSON.stringify(audit.record.mock.calls)).not.toContain(
        issued.code,
      );
    });

    it('fails as a whole when the audit row cannot be written', async () => {
      audit.record.mockRejectedValueOnce(new Error('audit down'));

      await expect(service.issue(trader.id, superadminId)).rejects.toThrow(
        'audit down',
      );
      expect(committed).toEqual([false]);
    });
  });

  describe('redeem', () => {
    it('records no login footprint, because the device is the superadmin’s and not the trader’s', async () => {
      const { code } = await service.issue(trader.id, superadminId);

      await service.redeem(code);

      expect(footprints.record).not.toHaveBeenCalled();
    });

    it('opens an ordinary session of the account, with a sid', async () => {
      const { code } = await service.issue(trader.id, superadminId);

      const session = await service.redeem(code);

      expect(
        jwt.verify(session.accessToken, { secret: ACCESS_SECRET }),
      ).toMatchObject({
        sub: trader.id,
        sid: STORED_SESSION_ID,
        role: Role.Trader,
        type: TokenType.Access,
      });
      expect(
        jwt.verify(session.refreshToken, { secret: REFRESH_SECRET }),
      ).toMatchObject({ sub: trader.id, type: TokenType.Refresh });
      expect(refreshTokens.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: trader.id,
          tokenHash: sha256Hex(session.refreshToken),
        }),
      );
    });

    it('tags the session with the superadmin who issued the link', async () => {
      const { code } = await service.issue(trader.id, superadminId);

      await service.redeem(code);

      expect(refreshTokens.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: trader.id,
          impersonatedByUserId: superadminId,
        }),
      );
    });

    it('spends the link and audits it in one transaction', async () => {
      const { code } = await service.issue(trader.id, superadminId);
      const linkId = stored[0].id;
      audit.record.mockClear();
      dataSource.transaction.mockClear();

      await service.redeem(code);

      expect(stored[0].usedAt).toBeInstanceOf(Date);
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        {
          actorUserId: trader.id,
          targetUserId: trader.id,
          action: 'user.login_link_used',
          metadata: { loginLinkId: linkId, issuedByUserId: superadminId },
        },
        manager,
      );
    });

    it('spends the link before the session is opened', async () => {
      const { code } = await service.issue(trader.id, superadminId);

      await service.redeem(code);

      expect(manager.update.mock.invocationCallOrder[0]).toBeLessThan(
        refreshTokens.save.mock.invocationCallOrder[0],
      );
    });

    it('refuses a second use of the same link', async () => {
      const { code } = await service.issue(trader.id, superadminId);
      await service.redeem(code);
      refreshTokens.save.mockClear();

      await expect(service.redeem(code)).rejects.toThrow(REJECTED);
      expect(refreshTokens.save).not.toHaveBeenCalled();
    });

    it('lets only one of two concurrent redemptions through', async () => {
      const { code } = await service.issue(trader.id, superadminId);

      const results = await Promise.allSettled([
        service.redeem(code),
        service.redeem(code),
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
      expect(
        audit.record.mock.calls.filter(
          ([entry]) => entry.action === 'user.login_link_used',
        ),
      ).toHaveLength(1);
    });

    it('refuses when the account was promoted to admin after the link was issued', async () => {
      const { code } = await service.issue(trader.id, superadminId);
      userDirectory.findAuthenticatableById.mockImplementation(
        async (id: string) =>
          id === superadminId ? superadmin : { ...trader, role: Role.Admin },
      );

      await expect(service.redeem(code)).rejects.toThrow(REJECTED);
      expect(refreshTokens.save).not.toHaveBeenCalled();
      expect(stored[0].usedAt).toBeNull();
    });

    it('refuses when the account was promoted to superadmin', async () => {
      const { code } = await service.issue(trader.id, superadminId);
      userDirectory.findAuthenticatableById.mockImplementation(
        async (id: string) =>
          id === superadminId
            ? superadmin
            : { ...trader, role: Role.Superadmin },
      );

      await expect(service.redeem(code)).rejects.toThrow(REJECTED);
    });

    it('refuses when the issuer is no longer a superadmin', async () => {
      const { code } = await service.issue(trader.id, superadminId);
      userDirectory.findAuthenticatableById.mockImplementation(
        async (id: string) =>
          id === superadminId ? { ...superadmin, role: Role.Admin } : trader,
      );

      await expect(service.redeem(code)).rejects.toThrow(REJECTED);
      expect(refreshTokens.save).not.toHaveBeenCalled();
      expect(stored[0].usedAt).toBeNull();
    });

    it('refuses when the issuer is suspended, and leaves the link unspent', async () => {
      const { code } = await service.issue(trader.id, superadminId);
      userDirectory.findAuthenticatableById.mockImplementation(
        async (id: string) =>
          id === superadminId
            ? { ...superadmin, status: UserStatus.Suspended }
            : trader,
      );

      await expect(service.redeem(code)).rejects.toThrow(REJECTED);
      expect(refreshTokens.save).not.toHaveBeenCalled();
      expect(stored[0].usedAt).toBeNull();
    });

    it('refuses when the issuer is blocked or gone', async () => {
      const { code } = await service.issue(trader.id, superadminId);
      userDirectory.findAuthenticatableById.mockImplementation(
        async (id: string) => (id === superadminId ? null : trader),
      );

      await expect(service.redeem(code)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(refreshTokens.save).not.toHaveBeenCalled();
    });

    it('refuses an expired link', async () => {
      const { code } = await service.issue(trader.id, superadminId);
      stored[0].expiresAt = new Date(Date.now() - 1);

      await expect(service.redeem(code)).rejects.toThrow(REJECTED);
      expect(refreshTokens.save).not.toHaveBeenCalled();
    });

    it('refuses a link that expires between the read and the spend', async () => {
      const { code } = await service.issue(trader.id, superadminId);
      userDirectory.findAuthenticatableById.mockImplementationOnce(async () => {
        stored[0].expiresAt = new Date(Date.now() - 1);

        return trader;
      });

      await expect(service.redeem(code)).rejects.toThrow(REJECTED);
      expect(refreshTokens.save).not.toHaveBeenCalled();
    });

    it('refuses an unknown code', async () => {
      await service.issue(trader.id, superadminId);

      await expect(service.redeem('not-a-real-code')).rejects.toThrow(REJECTED);
      expect(refreshTokens.save).not.toHaveBeenCalled();
    });

    it('refuses an account that is no longer authenticatable, and leaves no trace', async () => {
      const { code } = await service.issue(trader.id, superadminId);
      userDirectory.findAuthenticatableById.mockResolvedValue(null);
      audit.record.mockClear();

      await expect(service.redeem(code)).rejects.toThrow(REJECTED);
      expect(userDirectory.findAuthenticatableById).toHaveBeenCalledWith(
        trader.id,
      );
      expect(refreshTokens.save).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('answers every refusal with the same 401', async () => {
      const refusalOf = (code: string): Promise<unknown> =>
        service.redeem(code).then(
          () => null,
          (error: unknown) => error,
        );
      const errors: unknown[] = [await refusalOf('nope')];

      const { code: used } = await service.issue(trader.id, superadminId);
      await service.redeem(used);
      errors.push(await refusalOf(used));

      const { code: expired } = await service.issue(uuidOf(8), superadminId);
      stored[stored.length - 1].expiresAt = new Date(Date.now() - 1);
      errors.push(await refusalOf(expired));

      const { code: blocked } = await service.issue(uuidOf(9), superadminId);
      userDirectory.findAuthenticatableById.mockResolvedValue(null);
      errors.push(await refusalOf(blocked));

      for (const error of errors) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        expect((error as UnauthorizedException).message).toBe(REJECTED);
      }
    });
  });
});
