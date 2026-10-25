import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindOperator } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { MerchantsService } from '../../merchants/merchants.service';
import { User } from '../../users/entities/user.entity';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { Invite } from '../entities/invite.entity';
import { InvitesService } from '../invites.service';
import { InviteListQuery } from '../types/invite-list-query';
import { InviteSortField } from '../types/invite-sort-field';
import { InviteStatus, inviteStatus } from '../types/invite-status';

const HOUR_IN_MS = 60 * 60 * 1000;

describe('InvitesService', () => {
  const issuer = {
    id: uuidOf(1),
    email: 'admin@example.com',
    telegramUsername: null,
    role: Role.Admin,
  } as User;

  let lastSaved: Invite;
  let stored: Invite[] = [];

  const escapeRegExp = (text: string): string =>
    text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const likeExpression = (pattern: string): RegExp => {
    let expression = '';
    let index = 0;

    while (index < pattern.length) {
      const character = pattern[index];

      if (character === '\\' && index + 1 < pattern.length) {
        expression += escapeRegExp(pattern[index + 1]);
        index += 2;
        continue;
      }

      expression +=
        character === '%'
          ? '.*'
          : character === '_'
            ? '.'
            : escapeRegExp(character);
      index += 1;
    }

    return new RegExp(`^${expression}$`, 'i');
  };

  const matchesValue = (actual: unknown, expected: unknown): boolean => {
    if (!(expected instanceof FindOperator)) return actual === expected;

    if (expected.type === 'isNull') return actual === null;

    if (expected.type === 'not')
      return !matchesValue(actual, expected.child ?? expected.value);

    if (expected.type === 'moreThan')
      return (actual as Date).getTime() > (expected.value as Date).getTime();

    if (expected.type === 'lessThanOrEqual')
      return (actual as Date).getTime() <= (expected.value as Date).getTime();

    if (expected.type === 'ilike')
      return (
        typeof actual === 'string' &&
        likeExpression(expected.value as string).test(actual)
      );

    throw new Error(`unsupported find operator: ${expected.type}`);
  };

  const matchesCondition = (
    invite: Invite,
    condition: Record<string, unknown>,
  ): boolean =>
    Object.entries(condition).every(([field, value]) =>
      matchesValue(invite[field], value),
    );

  const sortValue = (value: unknown): any =>
    value instanceof Date ? value.getTime() : value;

  const byOrder =
    (order: Record<string, 'ASC' | 'DESC'>) =>
    (one: Invite, other: Invite): number => {
      for (const [field, direction] of Object.entries(order ?? {})) {
        const first = sortValue(one[field]);
        const second = sortValue(other[field]);

        if (first === second) continue;

        return (first < second ? -1 : 1) * (direction === 'ASC' ? 1 : -1);
      }

      return 0;
    };

  const invites = {
    findOne: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    create: jest.fn((data: Partial<Invite>) => ({ ...data })),
    save: jest.fn(async (invite: Invite) => {
      lastSaved = { id: 1, ...invite };

      return lastSaved;
    }),
  };

  const userDirectory = { isIdentifierTaken: jest.fn() };
  const merchants = { findById: jest.fn() };

  const pendingInvite = (overrides: Partial<Invite> = {}): Invite =>
    ({
      id: 1,
      telegramUsername: 'someone',
      role: Role.Trader,
      code: 'ABCDEFGHJKLMNPQR',
      expiresAt: new Date(Date.now() + HOUR_IN_MS),
      usedAt: null,
      usedBy: null,
      usedByUserId: null,
      revokedAt: null,
      revokedBy: null,
      revokedByUserId: null,
      createdBy: issuer,
      createdByUserId: uuidOf(1),
      ...overrides,
    }) as Invite;

  const createInvite = () =>
    service.create({
      telegramUsername: 'someone',
      role: Role.Trader,
      createdByUserId: uuidOf(1),
    });

  let service: InvitesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    invites.find.mockResolvedValue([]);
    stored = [];

    invites.findAndCount.mockImplementation(
      async ({
        where,
        order,
        skip = 0,
        take,
      }: {
        where: unknown;
        order: Record<string, 'ASC' | 'DESC'>;
        skip?: number;
        take?: number;
      }) => {
        const matched = stored
          .filter((invite) =>
            (Array.isArray(where) ? where : [where]).some((condition) =>
              matchesCondition(invite, condition as Record<string, unknown>),
            ),
          )
          .sort(byOrder(order));

        return [
          matched.slice(skip, take === undefined ? undefined : skip + take),
          matched.length,
        ];
      },
    );

    invites.findOne.mockImplementation(async () => ({
      ...lastSaved,
      createdBy: issuer,
    }));
    userDirectory.isIdentifierTaken.mockResolvedValue(false);
    merchants.findById.mockImplementation(async (id: string) =>
      id === uuidOf(50) ? { id, name: 'Ohla Shop' } : null,
    );

    const module = await Test.createTestingModule({
      providers: [
        InvitesService,
        { provide: getRepositoryToken(Invite), useValue: invites },
        { provide: UserDirectoryService, useValue: userDirectory },
        { provide: MerchantsService, useValue: merchants },
        { provide: ConfigService, useValue: { get: () => 72 } },
      ],
    }).compile();

    service = module.get(InvitesService);
  });

  describe('create', () => {
    it('issues an unambiguous code with the configured lifetime', async () => {
      const invite = await createInvite();

      expect(invite.code).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);
      expect(invite.createdByUserId).toBe(uuidOf(1));
      expect(invite.expiresAt.getTime() - Date.now()).toBeGreaterThan(
        71 * HOUR_IN_MS,
      );
      expect(invite.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
        72 * HOUR_IN_MS,
      );
    });

    it('takes the expiry it was given over the configured lifetime', async () => {
      const expiresAt = new Date(Date.now() + 5 * HOUR_IN_MS);

      const invite = await service.create({
        telegramUsername: 'someone',
        role: Role.Trader,
        createdByUserId: uuidOf(1),
        expiresAt,
      });

      expect(invite.expiresAt).toEqual(expiresAt);
    });

    it('stores the role the invite was issued for', async () => {
      const invite = await service.create({
        telegramUsername: 'someone',
        role: Role.LeadTrader,
        createdByUserId: uuidOf(1),
      });

      expect(invite.role).toBe(Role.LeadTrader);
    });

    describe('the merchant an invite binds to', () => {
      const MERCHANT_STAFF = [Role.MerchantSupport, Role.MerchantAgent];

      it.each(MERCHANT_STAFF)(
        'stores the merchant of a %s invite',
        async (role) => {
          const invite = await service.create({
            telegramUsername: 'someone',
            role,
            createdByUserId: uuidOf(1),
            merchantId: uuidOf(50),
          });

          expect(merchants.findById).toHaveBeenCalledWith(uuidOf(50));
          expect(invite.merchantId).toBe(uuidOf(50));
        },
      );

      it.each(MERCHANT_STAFF)(
        'refuses a %s invite with no merchant',
        async (role) => {
          await expect(
            service.create({
              telegramUsername: 'someone',
              role,
              createdByUserId: uuidOf(1),
            }),
          ).rejects.toBeInstanceOf(BadRequestException);
          expect(invites.save).not.toHaveBeenCalled();
        },
      );

      it.each(MERCHANT_STAFF)(
        'refuses a %s invite naming an unknown merchant',
        async (role) => {
          await expect(
            service.create({
              telegramUsername: 'someone',
              role,
              createdByUserId: uuidOf(1),
              merchantId: uuidOf(51),
            }),
          ).rejects.toBeInstanceOf(BadRequestException);
          expect(invites.save).not.toHaveBeenCalled();
        },
      );

      it.each(
        Object.values(Role).filter((role) => !MERCHANT_STAFF.includes(role)),
      )('refuses a merchant on a %s invite', async (role) => {
        await expect(
          service.create({
            telegramUsername: 'someone',
            role,
            createdByUserId: uuidOf(1),
            merchantId: uuidOf(50),
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(merchants.findById).not.toHaveBeenCalled();
        expect(invites.save).not.toHaveBeenCalled();
      });

      it('stores no merchant on an invite for any other role', async () => {
        const invite = await createInvite();

        expect(invite.merchantId).toBeNull();
        expect(merchants.findById).not.toHaveBeenCalled();
      });
    });

    it('normalises the telegram username it is issued for', async () => {
      const invite = await service.create({
        telegramUsername: ' @SomeOne ',
        role: Role.Merchant,
        createdByUserId: uuidOf(1),
      });

      expect(invite.telegramUsername).toBe('someone');
    });

    it('writes no email onto the invite', async () => {
      const invite = await createInvite();

      expect(invite).not.toHaveProperty('email');
    });

    it.each([[''], ['   '], ['@']])(
      'rejects the empty telegram username %p',
      async (telegramUsername) => {
        await expect(
          service.create({
            telegramUsername,
            role: Role.Trader,
            createdByUserId: uuidOf(1),
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(invites.save).not.toHaveBeenCalled();
      },
    );

    it('refuses an identifier that already belongs to a user', async () => {
      userDirectory.isIdentifierTaken.mockResolvedValue(true);

      await expect(createInvite()).rejects.toBeInstanceOf(ConflictException);
      expect(userDirectory.isIdentifierTaken).toHaveBeenCalledWith({
        telegramUsername: 'someone',
      });
      expect(invites.save).not.toHaveBeenCalled();
    });

    it('refuses a second code while the first one still works', async () => {
      invites.find.mockResolvedValue([pendingInvite()]);

      await expect(createInvite()).rejects.toBeInstanceOf(ConflictException);
      expect(invites.find).toHaveBeenCalledWith({
        where: { telegramUsername: 'someone' },
      });
      expect(invites.save).not.toHaveBeenCalled();
    });

    it('issues a new code once the previous one has been used', async () => {
      invites.find.mockResolvedValue([pendingInvite({ usedAt: new Date() })]);

      await expect(createInvite()).resolves.toBeDefined();
      expect(invites.save).toHaveBeenCalled();
    });

    it('issues a new code once the previous one has expired', async () => {
      invites.find.mockResolvedValue([
        pendingInvite({ expiresAt: new Date(Date.now() - HOUR_IN_MS) }),
      ]);

      await expect(createInvite()).resolves.toBeDefined();
      expect(invites.save).toHaveBeenCalled();
    });

    it('never repeats a code', async () => {
      const codes = new Set<string>();

      for (let attempt = 0; attempt < 20; attempt++) {
        codes.add((await createInvite()).code);
      }

      expect(codes.size).toBe(20);
    });

    it('hands back the invite with its issuer loaded', async () => {
      const invite = await createInvite();

      expect(invite.createdBy).toBe(issuer);
    });

    it('reloads the created invite exactly once, asking for the issuer', async () => {
      await createInvite();

      expect(invites.findOne).toHaveBeenCalledTimes(1);
      expect(invites.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
        relations: { createdBy: true },
      });
    });
  });

  describe('list', () => {
    const dayOf = (day: number): Date =>
      new Date(`2026-01-0${day}T00:00:00.000Z`);

    const expired = new Date(Date.now() - HOUR_IN_MS);
    const usable = new Date(Date.now() + HOUR_IN_MS);

    const population = (): Invite[] => [
      pendingInvite({
        id: 1,
        code: 'AAAA1111',
        telegramUsername: 'anna_k',
        expiresAt: usable,
        createdAt: dayOf(1),
      }),
      pendingInvite({
        id: 2,
        code: 'BBBB2222',
        telegramUsername: 'durov',
        role: Role.Merchant,
        expiresAt: usable,
        createdAt: dayOf(2),
      }),
      pendingInvite({
        id: 3,
        code: 'CCCC3333',
        telegramUsername: 'boris_b',
        expiresAt: usable,
        usedAt: dayOf(3),
        usedBy: issuer,
        usedByUserId: uuidOf(1),
        createdAt: dayOf(3),
      }),
      pendingInvite({
        id: 4,
        code: 'DDDD4444',
        telegramUsername: 'carl_c',
        role: Role.Admin,
        expiresAt: expired,
        usedAt: dayOf(4),
        usedBy: issuer,
        usedByUserId: uuidOf(1),
        createdAt: dayOf(4),
      }),
      pendingInvite({
        id: 5,
        code: 'EEEE5555',
        telegramUsername: 'dana_d',
        expiresAt: expired,
        createdAt: dayOf(5),
      }),
      pendingInvite({
        id: 6,
        code: 'FFFF6666',
        telegramUsername: 'discount_100',
        role: Role.Merchant,
        expiresAt: expired,
        createdAt: dayOf(6),
      }),
      pendingInvite({
        id: 7,
        code: 'GGGG7777',
        telegramUsername: 'agentx100',
        role: Role.Cascade,
        expiresAt: usable,
        createdAt: dayOf(7),
      }),
    ];

    const query = (
      overrides: Partial<InviteListQuery> = {},
    ): InviteListQuery => ({
      page: 1,
      limit: 20,
      sortBy: InviteSortField.CreatedAt,
      sortOrder: SortOrder.Desc,
      ...overrides,
    });

    const listedIds = async (
      overrides: Partial<InviteListQuery> = {},
    ): Promise<number[]> =>
      (await service.list(query(overrides))).items.map((invite) => invite.id);

    beforeEach(() => {
      stored.push(...population());
    });

    it('asks for both accounts in the one query, never per row', async () => {
      await service.list(query());

      expect(invites.findAndCount).toHaveBeenCalledTimes(1);
      expect(invites.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          relations: { createdBy: true, usedBy: true, revokedBy: true },
        }),
      );
      expect(invites.findOne).not.toHaveBeenCalled();
    });

    it('hands the loaded accounts through untouched', async () => {
      const { items } = await service.list(
        query({ sortBy: InviteSortField.Id, sortOrder: SortOrder.Asc }),
      );

      expect(items[0].createdBy).toBe(issuer);
      expect(items[0].usedBy).toBeNull();
      expect(items[2].usedBy).toBe(issuer);
    });

    describe('paging', () => {
      it('takes twenty newest rows when nothing is asked for', async () => {
        const page = await service.list(query());

        expect(invites.findAndCount).toHaveBeenCalledWith(
          expect.objectContaining({ skip: 0, take: 20 }),
        );
        expect(page.items.map((invite) => invite.id)).toEqual([
          7, 6, 5, 4, 3, 2, 1,
        ]);
        expect(page.meta).toEqual({ total: 7, page: 1, limit: 20, pages: 1 });
      });

      it('offsets the second page by a whole page', async () => {
        const page = await service.list(query({ page: 2, limit: 3 }));

        expect(invites.findAndCount).toHaveBeenCalledWith(
          expect.objectContaining({ skip: 3, take: 3 }),
        );
        expect(page.items.map((invite) => invite.id)).toEqual([4, 3, 2]);
        expect(page.meta).toEqual({ total: 7, page: 2, limit: 3, pages: 3 });
      });
    });

    describe('the computed status as a filter', () => {
      it.each([
        [InviteStatus.Pending, [7, 2, 1]],
        [InviteStatus.Used, [4, 3]],
        [InviteStatus.Expired, [6, 5]],
      ])('returns exactly the %s invites', async (status, ids) => {
        await expect(listedIds({ status })).resolves.toEqual(ids);
      });

      it.each([
        [InviteStatus.Pending, 3],
        [InviteStatus.Used, 2],
        [InviteStatus.Expired, 2],
      ])(
        'counts only the %s invites, even on a page that holds one',
        async (status, total) => {
          const page = await service.list(query({ status, limit: 1 }));

          expect(page.items).toHaveLength(1);
          expect(page.meta.total).toBe(total);
        },
      );

      it.each([InviteStatus.Pending, InviteStatus.Used, InviteStatus.Expired])(
        'agrees with the function that defines the %s state',
        async (status) => {
          const { items } = await service.list(query({ status }));

          expect(items).not.toHaveLength(0);
          expect(items.map((invite) => inviteStatus(invite))).toEqual(
            items.map(() => status),
          );
        },
      );

      it('counts a used invite as used even once its lifetime has run out', async () => {
        await expect(
          listedIds({ status: InviteStatus.Used }),
        ).resolves.toContain(4);
        await expect(
          listedIds({ status: InviteStatus.Expired }),
        ).resolves.not.toContain(4);
      });
    });

    describe('filters', () => {
      it('narrows by role', async () => {
        await expect(listedIds({ role: Role.Trader })).resolves.toEqual([
          5, 3, 1,
        ]);
      });

      it('narrows by role and status at once', async () => {
        await expect(
          listedIds({ role: Role.Trader, status: InviteStatus.Pending }),
        ).resolves.toEqual([1]);
      });
    });

    describe('search', () => {
      it('matches the code', async () => {
        await expect(listedIds({ search: 'AAAA1111' })).resolves.toEqual([1]);
      });

      it('matches the code whatever case it is typed in', async () => {
        await expect(listedIds({ search: 'aaaa1111' })).resolves.toEqual([1]);
      });

      it('matches a substring of the telegram username', async () => {
        await expect(listedIds({ search: 'DUROV' })).resolves.toEqual([2]);
      });

      it('treats an underscore as text, not as a wildcard', async () => {
        await expect(listedIds({ search: '_100' })).resolves.toEqual([6]);
        await expect(listedIds({ search: '100' })).resolves.toEqual([7, 6]);
      });

      it('searches the code and the telegram username and nothing else', async () => {
        await service.list(query({ search: 'boris' }));

        const [options] = invites.findAndCount.mock.calls[0] as [
          { where: Record<string, unknown>[] },
        ];

        expect(
          options.where.map((condition) => Object.keys(condition)),
        ).toEqual([['code'], ['telegramUsername']]);
      });

      it('narrows alongside the status rather than replacing it', async () => {
        await expect(
          listedIds({ search: '100', status: InviteStatus.Pending }),
        ).resolves.toEqual([7]);
      });

      it('counts only the rows it matched', async () => {
        const page = await service.list(query({ search: '100' }));

        expect(page.meta.total).toBe(2);
      });
    });

    describe('sorting', () => {
      const lastOrder = (): Record<string, string> => {
        const { calls } = invites.findAndCount.mock;
        const [options] = calls[calls.length - 1] as [
          { order: Record<string, string> },
        ];

        return options.order;
      };

      it.each([
        [InviteSortField.Id, { id: 'DESC' }],
        [InviteSortField.CreatedAt, { createdAt: 'DESC', id: 'DESC' }],
        [InviteSortField.ExpiresAt, { expiresAt: 'DESC', id: 'DESC' }],
        [InviteSortField.Role, { role: 'DESC', id: 'DESC' }],
      ])(
        'orders by %s, breaking ties on the identifier',
        async (sortBy, order) => {
          await service.list(query({ sortBy }));

          expect(lastOrder()).toEqual(order);
        },
      );

      it('turns the ascending order into the direction typeorm takes', async () => {
        await service.list(
          query({
            sortBy: InviteSortField.ExpiresAt,
            sortOrder: SortOrder.Asc,
          }),
        );

        expect(lastOrder()).toEqual({ expiresAt: 'ASC', id: 'ASC' });
      });

      it('reverses the rows when the order is reversed', async () => {
        await expect(
          listedIds({
            sortBy: InviteSortField.Id,
            sortOrder: SortOrder.Asc,
          }),
        ).resolves.toEqual([1, 2, 3, 4, 5, 6, 7]);
      });
    });
  });

  describe('assertUsable', () => {
    it('accepts a pending code typed with dashes and lower case', async () => {
      const invite = pendingInvite();
      invites.findOne.mockResolvedValue(invite);

      await expect(
        service.assertUsable('abcd-efgh-jklm-npqr', {
          telegramUsername: 'someone',
        }),
      ).resolves.toBe(invite);
      expect(invites.findOne).toHaveBeenCalledWith({
        where: { code: 'ABCDEFGHJKLMNPQR' },
      });
    });

    it('accepts the telegram username however it is typed', async () => {
      const invite = pendingInvite();
      invites.findOne.mockResolvedValue(invite);

      await expect(
        service.assertUsable('ABCDEFGHJKLMNPQR', {
          telegramUsername: '@SomeOne',
        }),
      ).resolves.toBe(invite);
    });

    it('rejects an unknown code', async () => {
      invites.findOne.mockResolvedValue(null);

      await expect(
        service.assertUsable('ABCDEFGHJKLMNPQR', {
          telegramUsername: 'someone',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an already used code', async () => {
      invites.findOne.mockResolvedValue(pendingInvite({ usedAt: new Date() }));

      await expect(
        service.assertUsable('ABCDEFGHJKLMNPQR', {
          telegramUsername: 'someone',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an expired code', async () => {
      invites.findOne.mockResolvedValue(
        pendingInvite({ expiresAt: new Date(Date.now() - HOUR_IN_MS) }),
      );

      await expect(
        service.assertUsable('ABCDEFGHJKLMNPQR', {
          telegramUsername: 'someone',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a code issued for another telegram username', async () => {
      invites.findOne.mockResolvedValue(pendingInvite());

      await expect(
        service.assertUsable('ABCDEFGHJKLMNPQR', {
          telegramUsername: 'somebody_else',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses to redeem an invite with an email login', async () => {
      invites.findOne.mockResolvedValue(pendingInvite());

      await expect(
        service.assertUsable('ABCDEFGHJKLMNPQR', {
          email: 'someone@example.com',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a login carrying an email beside the right username', async () => {
      invites.findOne.mockResolvedValue(pendingInvite());

      await expect(
        service.assertUsable('ABCDEFGHJKLMNPQR', {
          email: 'someone@example.com',
          telegramUsername: 'someone',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses an identifier carrying nothing', async () => {
      invites.findOne.mockResolvedValue(pendingInvite());

      await expect(
        service.assertUsable('ABCDEFGHJKLMNPQR', {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('consume', () => {
    it('burns the code and records who used it', async () => {
      const invite = pendingInvite();
      invites.findOne.mockResolvedValue(invite);

      await service.consume(
        'ABCDEFGHJKLMNPQR',
        { telegramUsername: 'someone' },
        uuidOf(7),
      );

      expect(invite.usedAt).toBeInstanceOf(Date);
      expect(invite.usedByUserId).toBe(uuidOf(7));
      expect(invites.save).toHaveBeenCalledWith(invite);
    });

    it('refuses to burn the same code twice', async () => {
      invites.findOne.mockResolvedValue(pendingInvite({ usedAt: new Date() }));

      await expect(
        service.consume(
          'ABCDEFGHJKLMNPQR',
          { telegramUsername: 'someone' },
          uuidOf(2),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(invites.save).not.toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('marks a pending invite revoked and records who did it', async () => {
      const invite = pendingInvite();
      invites.findOne.mockResolvedValue(invite);

      await service.revoke(1, uuidOf(4));

      expect(invite.revokedAt).toBeInstanceOf(Date);
      expect(invite.revokedByUserId).toBe(uuidOf(4));
      expect(invites.save).toHaveBeenCalledWith(invite);
      expect(inviteStatus(invite)).toBe(InviteStatus.Revoked);
    });

    it('answers not found for an invite that does not exist', async () => {
      invites.findOne.mockResolvedValue(null);

      await expect(service.revoke(1, uuidOf(4))).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(invites.save).not.toHaveBeenCalled();
    });

    it('refuses to revoke an invite somebody already redeemed', async () => {
      invites.findOne.mockResolvedValue(
        pendingInvite({ usedAt: new Date(), usedByUserId: uuidOf(9) }),
      );

      await expect(service.revoke(1, uuidOf(4))).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(invites.save).not.toHaveBeenCalled();
    });

    it('refuses to revoke the same invite twice', async () => {
      invites.findOne.mockResolvedValue(
        pendingInvite({ revokedAt: new Date(), revokedByUserId: uuidOf(4) }),
      );

      await expect(service.revoke(1, uuidOf(4))).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(invites.save).not.toHaveBeenCalled();
    });

    it('revokes an invite that had already expired', async () => {
      const invite = pendingInvite({
        expiresAt: new Date(Date.now() - HOUR_IN_MS),
      });
      invites.findOne.mockResolvedValue(invite);

      await service.revoke(1, uuidOf(4));

      expect(inviteStatus(invite)).toBe(InviteStatus.Revoked);
    });

    it('stops the code being redeemed', async () => {
      const invite = pendingInvite();
      invites.findOne.mockResolvedValue(invite);

      await service.revoke(1, uuidOf(4));

      await expect(
        service.assertUsable('ABCDEFGHJKLMNPQR', {
          telegramUsername: 'someone',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('frees the identifier, so a fresh invite can be issued', async () => {
      invites.find.mockResolvedValue([
        pendingInvite({ revokedAt: new Date(), revokedByUserId: uuidOf(4) }),
      ]);

      await expect(createInvite()).resolves.toBeDefined();
    });
  });

  describe('extend', () => {
    const later = () => new Date(Date.now() + 10 * HOUR_IN_MS);
    const expiredInvite = (overrides: Partial<Invite> = {}) =>
      pendingInvite({
        expiresAt: new Date(Date.now() - HOUR_IN_MS),
        ...overrides,
      });

    it('moves the expiry of a pending invite without looking for another live one', async () => {
      const invite = pendingInvite();
      const expiresAt = later();
      invites.findOne.mockResolvedValue(invite);

      await service.extend(1, expiresAt);

      expect(invite.expiresAt).toEqual(expiresAt);
      expect(invites.save).toHaveBeenCalledWith(invite);
      expect(userDirectory.isIdentifierTaken).toHaveBeenCalledTimes(1);
      expect(invites.find).not.toHaveBeenCalled();
    });

    it('refuses to extend a pending invite once the account exists', async () => {
      invites.findOne.mockResolvedValue(pendingInvite());
      userDirectory.isIdentifierTaken.mockResolvedValue(true);

      await expect(service.extend(1, later())).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(invites.find).not.toHaveBeenCalled();
      expect(invites.save).not.toHaveBeenCalled();
    });

    it('reads the invite back with the accounts behind it', async () => {
      invites.findOne.mockResolvedValue(pendingInvite());

      await service.extend(1, later());

      expect(invites.findOne).toHaveBeenLastCalledWith({
        where: { id: 1 },
        relations: { createdBy: true, usedBy: true, revokedBy: true },
      });
    });

    it('revives an expired invite', async () => {
      const invite = expiredInvite();
      invites.findOne.mockResolvedValue(invite);
      invites.find.mockResolvedValue([invite]);

      await service.extend(1, later());

      expect(inviteStatus(invite)).toBe(InviteStatus.Pending);
      expect(invites.save).toHaveBeenCalledWith(invite);
    });

    it('answers not found for an invite that does not exist', async () => {
      invites.findOne.mockResolvedValue(null);

      await expect(service.extend(1, later())).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(invites.save).not.toHaveBeenCalled();
    });

    it('refuses an invite somebody already redeemed', async () => {
      invites.findOne.mockResolvedValue(
        pendingInvite({ usedAt: new Date(), usedByUserId: uuidOf(9) }),
      );

      await expect(service.extend(1, later())).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(invites.save).not.toHaveBeenCalled();
    });

    it('refuses a revoked invite', async () => {
      invites.findOne.mockResolvedValue(
        pendingInvite({ revokedAt: new Date(), revokedByUserId: uuidOf(4) }),
      );

      await expect(service.extend(1, later())).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(invites.save).not.toHaveBeenCalled();
    });

    it('refuses to revive an expired invite once the account exists', async () => {
      invites.findOne.mockResolvedValue(expiredInvite());
      userDirectory.isIdentifierTaken.mockResolvedValue(true);

      await expect(service.extend(1, later())).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(userDirectory.isIdentifierTaken).toHaveBeenCalledWith({
        telegramUsername: 'someone',
      });
      expect(invites.save).not.toHaveBeenCalled();
    });

    it('refuses to revive an expired invite while another one is live', async () => {
      invites.findOne.mockResolvedValue(expiredInvite());
      invites.find.mockResolvedValue([pendingInvite({ id: 2 })]);

      await expect(service.extend(1, later())).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(invites.save).not.toHaveBeenCalled();
    });

    it('looks for another live invite by the telegram username', async () => {
      invites.findOne.mockResolvedValue(expiredInvite());

      await service.extend(1, later());

      expect(invites.find).toHaveBeenCalledWith({
        where: { telegramUsername: 'someone' },
      });
    });

    it('refuses to extend a legacy invite with no telegram username', async () => {
      invites.findOne.mockResolvedValue(
        pendingInvite({ telegramUsername: null }),
      );

      await expect(service.extend(1, later())).rejects.toThrow(
        'This invite can no longer be redeemed',
      );
      expect(userDirectory.isIdentifierTaken).not.toHaveBeenCalled();
      expect(invites.find).not.toHaveBeenCalled();
      expect(invites.save).not.toHaveBeenCalled();
    });

    it('still reports a used legacy invite as used', async () => {
      invites.findOne.mockResolvedValue(
        pendingInvite({ telegramUsername: null, usedAt: new Date() }),
      );

      await expect(service.extend(1, later())).rejects.toThrow(
        'This invite has already been used',
      );
    });
  });
});
