import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, Not } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { User } from '../entities/user.entity';
import { UserDirectoryService } from '../services/user-directory.service';
import { UserListQuery } from '../types/user-list-query';
import { UserSortField } from '../types/user-sort-field.enum';
import { UserStatus } from '../types/user-status.enum';
import { createFakeRepository, FakeRepository } from './fake-repository.spec';

describe('UserDirectoryService', () => {
  let stored: Partial<User>[];
  let users: FakeRepository;
  let service: UserDirectoryService;

  beforeEach(async () => {
    stored = [];
    users = createFakeRepository(stored);

    const module = await Test.createTestingModule({
      providers: [
        UserDirectoryService,
        { provide: getRepositoryToken(User), useValue: users },
      ],
    }).compile();

    service = module.get(UserDirectoryService);
  });

  describe('findAuthenticatableByLogin', () => {
    const authenticatable = In([UserStatus.Active, UserStatus.Suspended]);

    it('looks an email login up by email only', async () => {
      await service.findAuthenticatableByLogin(' User@Example.com ');

      expect(users.findOne).toHaveBeenCalledWith({
        where: [{ email: 'user@example.com', status: authenticatable }],
      });
    });

    it('looks a telegram login up by telegram username only', async () => {
      await service.findAuthenticatableByLogin('@Durov');

      expect(users.findOne).toHaveBeenCalledWith({
        where: [{ telegramUsername: 'durov', status: authenticatable }],
      });
    });

    it('returns the active user behind either kind of login', async () => {
      const byEmail = { email: 'user@example.com', status: UserStatus.Active };
      const byTelegram = {
        telegramUsername: 'durov',
        status: UserStatus.Active,
      };
      stored.push(byEmail, byTelegram);

      await expect(
        service.findAuthenticatableByLogin('user@example.com'),
      ).resolves.toBe(byEmail);
      await expect(service.findAuthenticatableByLogin('durov')).resolves.toBe(
        byTelegram,
      );
    });

    it('does not reach a telegram user through an email login', async () => {
      stored.push({ telegramUsername: 'durov', status: UserStatus.Active });

      await expect(
        service.findAuthenticatableByLogin('durov@example.com'),
      ).resolves.toBeNull();
    });

    it('ignores a user who never confirmed two-factor', async () => {
      stored.push({
        email: 'user@example.com',
        status: UserStatus.PendingTwoFactor,
      });

      await expect(
        service.findAuthenticatableByLogin('user@example.com'),
      ).resolves.toBeNull();
    });

    it('returns a suspended user, who may still sign in and read', async () => {
      const suspended = {
        email: 'user@example.com',
        status: UserStatus.Suspended,
      };
      stored.push(suspended);

      await expect(
        service.findAuthenticatableByLogin('user@example.com'),
      ).resolves.toBe(suspended);
    });

    it('ignores a blocked user', async () => {
      stored.push({ email: 'user@example.com', status: UserStatus.Blocked });

      await expect(
        service.findAuthenticatableByLogin('user@example.com'),
      ).resolves.toBeNull();
    });
  });

  describe('isIdentifierTaken', () => {
    it('reports an email held by an active user', async () => {
      stored.push({ email: 'user@example.com', status: UserStatus.Active });

      await expect(
        service.isIdentifierTaken({ email: ' User@Example.com ' }),
      ).resolves.toBe(true);
    });

    it('reports a telegram username held by an active user', async () => {
      stored.push({ telegramUsername: 'durov', status: UserStatus.Active });

      await expect(
        service.isIdentifierTaken({ telegramUsername: '@Durov' }),
      ).resolves.toBe(true);
    });

    it('reports an email held by a suspended user', async () => {
      stored.push({ email: 'user@example.com', status: UserStatus.Suspended });

      await expect(
        service.isIdentifierTaken({ email: 'user@example.com' }),
      ).resolves.toBe(true);
    });

    it('reports an email held by a blocked user, who still owns it', async () => {
      stored.push({ email: 'user@example.com', status: UserStatus.Blocked });

      await expect(
        service.isIdentifierTaken({ email: 'user@example.com' }),
      ).resolves.toBe(true);
    });

    it('ignores a user who never confirmed two-factor', async () => {
      stored.push({
        email: 'user@example.com',
        status: UserStatus.PendingTwoFactor,
      });

      await expect(
        service.isIdentifierTaken({ email: 'user@example.com' }),
      ).resolves.toBe(false);
      expect(users.findOne).toHaveBeenCalledWith({
        where: [
          {
            email: 'user@example.com',
            status: Not(UserStatus.PendingTwoFactor),
          },
        ],
      });
    });

    it('does not confuse the two kinds of identifier', async () => {
      stored.push({ email: 'durov@example.com', status: UserStatus.Active });

      await expect(
        service.isIdentifierTaken({ telegramUsername: 'durov' }),
      ).resolves.toBe(false);
    });

    it('reports a free identifier', async () => {
      await expect(
        service.isIdentifierTaken({ email: 'nobody@example.com' }),
      ).resolves.toBe(false);
    });
  });

  describe('findAuthenticatableById', () => {
    it('ignores a user who never confirmed two-factor', async () => {
      stored.push({ id: uuidOf(1), status: UserStatus.PendingTwoFactor });

      await expect(
        service.findAuthenticatableById(uuidOf(1)),
      ).resolves.toBeNull();
    });

    it('returns an active user', async () => {
      const user = { id: uuidOf(1), status: UserStatus.Active };
      stored.push(user);

      await expect(service.findAuthenticatableById(uuidOf(1))).resolves.toBe(
        user,
      );
    });

    it('returns a suspended user', async () => {
      const user = { id: uuidOf(1), status: UserStatus.Suspended };
      stored.push(user);

      await expect(service.findAuthenticatableById(uuidOf(1))).resolves.toBe(
        user,
      );
    });

    it('ignores a blocked user, which is what makes blocking instant', async () => {
      stored.push({ id: uuidOf(1), status: UserStatus.Blocked });

      await expect(
        service.findAuthenticatableById(uuidOf(1)),
      ).resolves.toBeNull();
    });
  });

  describe('findById', () => {
    it('returns a blocked user, so an admin can unblock them', async () => {
      const user = { id: uuidOf(1), status: UserStatus.Blocked };
      stored.push(user);

      await expect(service.findById(uuidOf(1))).resolves.toBe(user);
    });

    it('returns a user who never confirmed two-factor', async () => {
      const user = { id: uuidOf(1), status: UserStatus.PendingTwoFactor };
      stored.push(user);

      await expect(service.findById(uuidOf(1))).resolves.toBe(user);
    });

    it('returns null for an unknown id', async () => {
      stored.push({ id: uuidOf(1), status: UserStatus.Active });

      await expect(service.findById(uuidOf(404))).resolves.toBeNull();
    });

    it('does not narrow by status', async () => {
      await service.findById(uuidOf(1));

      expect(users.findOne).toHaveBeenCalledWith({ where: { id: uuidOf(1) } });
    });
  });

  describe('findByLogin', () => {
    it('does not narrow by status', async () => {
      await service.findByLogin(' User@Example.com ');

      expect(users.findOne).toHaveBeenCalledWith({
        where: [{ email: 'user@example.com' }],
      });
    });

    it('reaches a user whose second factor was reset', async () => {
      const resetUser = {
        id: uuidOf(1),
        email: 'user@example.com',
        status: UserStatus.PendingTwoFactor,
      };
      stored.push(resetUser);

      await expect(service.findByLogin('user@example.com')).resolves.toBe(
        resetUser,
      );
      await expect(
        service.findAuthenticatableByLogin('user@example.com'),
      ).resolves.toBeNull();
    });

    it('reaches a blocked user', async () => {
      const blocked = {
        id: uuidOf(1),
        telegramUsername: 'durov',
        status: UserStatus.Blocked,
      };
      stored.push(blocked);

      await expect(service.findByLogin('@Durov')).resolves.toBe(blocked);
    });

    it('does not confuse the two kinds of identifier', async () => {
      stored.push({
        id: uuidOf(1),
        telegramUsername: 'durov',
        status: UserStatus.Active,
      });

      await expect(
        service.findByLogin('durov@example.com'),
      ).resolves.toBeNull();
    });

    it('returns null for an unknown login', async () => {
      await expect(
        service.findByLogin('nobody@example.com'),
      ).resolves.toBeNull();
    });
  });

  describe('requireById', () => {
    it('returns the row when there is one', async () => {
      const user = { id: uuidOf(1), status: UserStatus.Active };
      stored.push(user);

      await expect(service.requireById(uuidOf(1))).resolves.toBe(user);
    });

    it('refuses an unknown user', async () => {
      await expect(service.requireById(uuidOf(404))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('assertHeldByNobodyElse', () => {
    it('stays quiet when nobody holds the identifier', async () => {
      await expect(
        service.assertHeldByNobodyElse(uuidOf(1), {
          email: 'free@example.com',
        }),
      ).resolves.toBeUndefined();
    });

    it('stays quiet when the identifier is the caller own', async () => {
      stored.push({
        id: uuidOf(1),
        email: 'user@example.com',
        status: UserStatus.Active,
      });

      await expect(
        service.assertHeldByNobodyElse(uuidOf(1), {
          email: ' User@Example.com ',
        }),
      ).resolves.toBeUndefined();
    });

    it('refuses an identifier another registered user holds', async () => {
      stored.push({
        id: uuidOf(2),
        email: 'user@example.com',
        status: UserStatus.Blocked,
      });

      await expect(
        service.assertHeldByNobodyElse(uuidOf(1), {
          email: 'user@example.com',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('ignores an identifier parked on an unfinished registration', async () => {
      stored.push({
        id: uuidOf(2),
        email: 'user@example.com',
        status: UserStatus.PendingTwoFactor,
      });

      await expect(
        service.assertHeldByNobodyElse(uuidOf(1), {
          email: 'user@example.com',
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('list', () => {
    const dayOf = (day: number): Date =>
      new Date(`2026-01-0${day}T00:00:00.000Z`);

    const population: Partial<User>[] = [
      {
        id: uuidOf(1),
        email: 'anna@example.com',
        telegramUsername: null,
        role: Role.Trader,
        status: UserStatus.Active,
        createdAt: dayOf(1),
      },
      {
        id: uuidOf(2),
        email: null,
        telegramUsername: 'durov',
        role: Role.Merchant,
        status: UserStatus.Suspended,
        createdAt: dayOf(2),
      },
      {
        id: uuidOf(3),
        email: 'boris@example.com',
        telegramUsername: 'boris_tg',
        role: Role.Trader,
        status: UserStatus.Blocked,
        createdAt: dayOf(3),
      },
      {
        id: uuidOf(4),
        email: 'discount100%@example.com',
        telegramUsername: null,
        role: Role.Admin,
        status: UserStatus.Active,
        createdAt: dayOf(4),
      },
      {
        id: uuidOf(5),
        email: 'anna-backup@example.com',
        telegramUsername: null,
        role: Role.Trader,
        status: UserStatus.Active,
        createdAt: dayOf(5),
      },
      {
        id: uuidOf(6),
        email: 'agent100@example.com',
        telegramUsername: null,
        role: Role.Merchant,
        status: UserStatus.PendingTwoFactor,
        createdAt: dayOf(6),
      },
    ];

    const query = (overrides: Partial<UserListQuery> = {}): UserListQuery => ({
      page: 1,
      limit: 20,
      sortBy: UserSortField.CreatedAt,
      sortOrder: SortOrder.Desc,
      ...overrides,
    });

    const listedIds = async (
      overrides: Partial<UserListQuery> = {},
    ): Promise<string[]> =>
      (await service.list(query(overrides))).items.map((user) => user.id);

    beforeEach(() => {
      stored.push(...population);
    });

    it('reads the rows and the total from a single query', async () => {
      const page = await service.list(query());

      expect(users.findAndCount).toHaveBeenCalledTimes(1);
      expect(page.items).toHaveLength(6);
      expect(page.meta.total).toBe(6);
    });

    it('lists every status, hiding nobody', async () => {
      await expect(listedIds({ sortBy: UserSortField.Id })).resolves.toEqual(
        [6, 5, 4, 3, 2, 1].map(uuidOf),
      );
    });

    describe('paging', () => {
      it('takes twenty newest rows when nothing is asked for', async () => {
        const page = await service.list(query());

        expect(users.findAndCount).toHaveBeenCalledWith(
          expect.objectContaining({ skip: 0, take: 20 }),
        );
        expect(page.items.map((user) => user.id)).toEqual(
          [6, 5, 4, 3, 2, 1].map(uuidOf),
        );
        expect(page.meta).toEqual({
          total: 6,
          page: 1,
          limit: 20,
          pages: 1,
        });
      });

      it('offsets the second page by a whole page', async () => {
        const page = await service.list(query({ page: 2, limit: 2 }));

        expect(users.findAndCount).toHaveBeenCalledWith(
          expect.objectContaining({ skip: 2, take: 2 }),
        );
        expect(page.items.map((user) => user.id)).toEqual([4, 3].map(uuidOf));
        expect(page.meta).toEqual({ total: 6, page: 2, limit: 2, pages: 3 });
      });

      it('counts every match, not only the rows on the page', async () => {
        const page = await service.list(query({ page: 3, limit: 1 }));

        expect(page.items).toHaveLength(1);
        expect(page.meta.total).toBe(6);
      });
    });

    describe('filters', () => {
      it('narrows by role', async () => {
        await expect(
          listedIds({ role: Role.Trader, sortBy: UserSortField.Id }),
        ).resolves.toEqual([5, 3, 1].map(uuidOf));
      });

      it('narrows by status', async () => {
        await expect(
          listedIds({ status: UserStatus.Active, sortBy: UserSortField.Id }),
        ).resolves.toEqual([5, 4, 1].map(uuidOf));
      });

      it('narrows by both at once', async () => {
        await expect(
          listedIds({
            role: Role.Trader,
            status: UserStatus.Active,
            sortBy: UserSortField.Id,
          }),
        ).resolves.toEqual([5, 1].map(uuidOf));
      });

      it('counts only what the filter left', async () => {
        const page = await service.list(query({ role: Role.Trader }));

        expect(page.meta.total).toBe(3);
      });
    });

    describe('search', () => {
      it('matches a substring of the email', async () => {
        await expect(
          listedIds({ search: 'boris', sortBy: UserSortField.Id }),
        ).resolves.toEqual([3].map(uuidOf));
      });

      it('matches a substring of the telegram username', async () => {
        await expect(
          listedIds({ search: 'durov', sortBy: UserSortField.Id }),
        ).resolves.toEqual([2].map(uuidOf));
      });

      it('matches either field, not only the first', async () => {
        await expect(
          listedIds({ search: 'boris_tg', sortBy: UserSortField.Id }),
        ).resolves.toEqual([3].map(uuidOf));
      });

      it('ignores case', async () => {
        await expect(
          listedIds({ search: 'ANNA', sortBy: UserSortField.Id }),
        ).resolves.toEqual([5, 1].map(uuidOf));
        await expect(
          listedIds({ search: 'DuRoV', sortBy: UserSortField.Id }),
        ).resolves.toEqual([2].map(uuidOf));
      });

      it('narrows alongside a filter rather than replacing it', async () => {
        await expect(
          listedIds({
            search: 'anna',
            role: Role.Trader,
            status: UserStatus.Active,
            sortBy: UserSortField.Id,
          }),
        ).resolves.toEqual([5, 1].map(uuidOf));
      });

      it('treats a percent sign as text, not as a wildcard', async () => {
        await expect(
          listedIds({ search: '100%', sortBy: UserSortField.Id }),
        ).resolves.toEqual([4].map(uuidOf));
        await expect(
          listedIds({ search: '100', sortBy: UserSortField.Id }),
        ).resolves.toEqual([6, 4].map(uuidOf));
      });

      it('treats an underscore as text, not as a single-character wildcard', async () => {
        await expect(
          listedIds({ search: 'anna_backup', sortBy: UserSortField.Id }),
        ).resolves.toEqual([]);
        await expect(
          listedIds({ search: 'anna-backup', sortBy: UserSortField.Id }),
        ).resolves.toEqual([5].map(uuidOf));
      });

      it('counts only the rows it matched', async () => {
        const page = await service.list(query({ search: 'anna' }));

        expect(page.meta.total).toBe(2);
      });
    });

    describe('sorting', () => {
      const lastOrder = (): Record<string, string> => {
        const { calls } = users.findAndCount.mock;
        const [options] = calls[calls.length - 1] as [
          { order: Record<string, string> },
        ];

        return options.order;
      };

      it.each([
        [UserSortField.Id, { id: 'DESC' }],
        [UserSortField.CreatedAt, { createdAt: 'DESC', id: 'DESC' }],
        [UserSortField.Role, { role: 'DESC', id: 'DESC' }],
        [UserSortField.Status, { status: 'DESC', id: 'DESC' }],
        [UserSortField.Email, { email: 'DESC', id: 'DESC' }],
      ])(
        'orders by %s, breaking ties on the identifier',
        async (sortBy, order) => {
          await service.list(query({ sortBy }));

          expect(lastOrder()).toEqual(order);
        },
      );

      it('turns the ascending order into the direction typeorm takes', async () => {
        await service.list(
          query({ sortBy: UserSortField.Email, sortOrder: SortOrder.Asc }),
        );

        expect(lastOrder()).toEqual({ email: 'ASC', id: 'ASC' });
      });

      it('reverses the rows when the order is reversed', async () => {
        await expect(
          listedIds({ sortBy: UserSortField.Id, sortOrder: SortOrder.Asc }),
        ).resolves.toEqual([1, 2, 3, 4, 5, 6].map(uuidOf));
      });

      it('orders by a column other than the identifier', async () => {
        await expect(
          listedIds({
            sortBy: UserSortField.Email,
            sortOrder: SortOrder.Asc,
            role: Role.Trader,
          }),
        ).resolves.toEqual([5, 1, 3].map(uuidOf));
      });
    });
  });
});
