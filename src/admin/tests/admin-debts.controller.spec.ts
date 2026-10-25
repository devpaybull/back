import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { Page } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { DebtEvent } from '../../debts/entities/debt-event.entity';
import { Debt } from '../../debts/entities/debt.entity';
import { DebtEventSortField } from '../../debts/types/debt-event-sort-field.enum';
import { DebtEventType } from '../../debts/types/debt-event-type.enum';
import { DebtSortField } from '../../debts/types/debt-sort-field.enum';
import { User } from '../../users/entities/user.entity';
import { UserStatus } from '../../users/types/user-status.enum';
import { AdminDebtsController } from '../controllers/admin-debts.controller';
import { ListDebtEventsQueryDto } from '../dto/list-debt-events-query.dto';
import { ListDebtsQueryDto } from '../dto/list-debts-query.dto';

describe('AdminDebtsController', () => {
  const superadmin: AuthenticatedUser = {
    id: uuidOf(9),
    login: 'root@example.com',
    role: Role.Superadmin,
    status: UserStatus.Active,
  };

  const debtor = {
    id: uuidOf(1),
    role: Role.Trader,
    email: null,
    telegramUsername: 'durov',
  } as unknown as User;

  const issuer = {
    id: uuidOf(9),
    role: Role.Superadmin,
    email: 'root@example.com',
    telegramUsername: null,
  } as unknown as User;

  const debt = (overrides: Partial<Debt> = {}): Debt =>
    ({
      id: 5,
      userId: debtor.id,
      user: debtor,
      issuedByUserId: issuer.id,
      issuedBy: issuer,
      amount: 400,
      remaining: 400,
      comment: null,
      autoWriteOffAt: null,
      autoWriteOffPaused: false,
      createdAt: new Date('2026-10-24T10:00:00Z'),
      ...overrides,
    }) as Debt;

  let debts: {
    issue: jest.Mock;
    list: jest.Mock;
    listEvents: jest.Mock;
    writeOff: jest.Mock;
    update: jest.Mock;
  };
  let directory: { findById: jest.Mock };
  let controller: AdminDebtsController;

  beforeEach(() => {
    debts = {
      issue: jest.fn(async () => debt()),
      list: jest.fn(),
      listEvents: jest.fn(),
      writeOff: jest.fn(async () => debt({ remaining: 0 })),
      update: jest.fn(async () => debt({ comment: 'x' })),
    };
    directory = { findById: jest.fn(async () => debtor) };
    controller = new AdminDebtsController(debts as never, directory as never);
  });

  describe('access', () => {
    it('is guarded for superadmin only', () => {
      expect(
        Reflect.getMetadata(ROLES_METADATA_KEY, AdminDebtsController),
      ).toEqual([Role.Superadmin]);
    });

    it.each([
      ['issue', true],
      ['writeOff', true],
      ['update', true],
      ['list', undefined],
      ['events', undefined],
    ] as const)('marks %s as a write: %p', (handler, expected) => {
      expect(
        Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller[handler]),
      ).toBe(expected);
    });

    const contextFor = (
      role: Role,
      handler: keyof AdminDebtsController,
    ): ExecutionContext =>
      ({
        getHandler: () => controller[handler],
        getClass: () => AdminDebtsController,
        switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      }) as unknown as ExecutionContext;

    it.each(['issue', 'list', 'events', 'writeOff', 'update'] as const)(
      'refuses an admin on %s with a 403',
      (handler) => {
        const guard = new RolesGuard(new Reflector());

        expect(() =>
          guard.canActivate(contextFor(Role.Admin, handler)),
        ).toThrow(ForbiddenException);
      },
    );

    it('lets a superadmin through', () => {
      const guard = new RolesGuard(new Reflector());

      expect(guard.canActivate(contextFor(Role.Superadmin, 'issue'))).toBe(
        true,
      );
    });
  });

  describe('issue', () => {
    it('lends to the account and answers with the debt', async () => {
      await expect(
        controller.issue(debtor.id, { amount: 400 }, superadmin),
      ).resolves.toEqual({
        id: 5,
        user: { id: debtor.id, login: 'durov', telegramUsername: 'durov' },
        issuedBy: {
          id: issuer.id,
          login: 'root@example.com',
          role: Role.Superadmin,
        },
        amount: 400,
        remaining: 400,
        repaid: false,
        comment: null,
        autoWriteOffAt: null,
        autoWriteOffPaused: false,
        createdAt: new Date('2026-10-24T10:00:00Z'),
      });
      expect(debts.issue).toHaveBeenCalledWith(debtor.id, 400, superadmin.id);
    });

    it('refuses lending to yourself with a 403', async () => {
      await expect(
        controller.issue(superadmin.id, { amount: 1 }, superadmin),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(debts.issue).not.toHaveBeenCalled();
    });

    it('404 when the account is unknown', async () => {
      directory.findById.mockResolvedValue(null);

      await expect(
        controller.issue(debtor.id, { amount: 1 }, superadmin),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(debts.issue).not.toHaveBeenCalled();
    });

    it('passes the service refusal of a role that cannot borrow through', async () => {
      directory.findById.mockResolvedValue({ ...debtor, role: Role.Merchant });
      debts.issue.mockRejectedValue(new BadRequestException('role'));

      await expect(
        controller.issue(debtor.id, { amount: 1 }, superadmin),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('applies canIssueRole to the target', async () => {
      const admin = { ...superadmin, role: Role.Admin };
      directory.findById.mockResolvedValue({
        ...debtor,
        role: Role.Superadmin,
      });

      await expect(
        controller.issue(debtor.id, { amount: 1 }, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(debts.issue).not.toHaveBeenCalled();
    });
  });

  describe('writeOff', () => {
    it('passes an absent amount through as the whole remaining debt', async () => {
      const answer = await controller.writeOff(5, {}, superadmin);

      expect(debts.writeOff).toHaveBeenCalledWith(5, undefined, superadmin.id);
      expect(answer.repaid).toBe(true);
    });

    it('passes a partial amount through', async () => {
      await controller.writeOff(5, { amount: 12.5 }, superadmin);

      expect(debts.writeOff).toHaveBeenCalledWith(5, 12.5, superadmin.id);
    });
  });

  describe('a debt id', () => {
    it.each([0, -1, 2147483648])(
      'refuses %p with a 400 before reaching the service',
      async (id) => {
        await expect(
          controller.events(id, {} as ListDebtEventsQueryDto),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          controller.writeOff(id, {}, superadmin),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          controller.update(id, { comment: 'x' }, superadmin),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(debts.listEvents).not.toHaveBeenCalled();
        expect(debts.writeOff).not.toHaveBeenCalled();
        expect(debts.update).not.toHaveBeenCalled();
      },
    );

    it('accepts the largest int', async () => {
      await controller.writeOff(2147483647, {}, superadmin);

      expect(debts.writeOff).toHaveBeenCalledWith(
        2147483647,
        undefined,
        superadmin.id,
      );
    });
  });

  describe('update', () => {
    it('refuses an empty body with a 400', async () => {
      await expect(controller.update(5, {}, superadmin)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(debts.update).not.toHaveBeenCalled();
    });

    it('treats a null comment as a change', async () => {
      await controller.update(5, { comment: null }, superadmin);

      expect(debts.update).toHaveBeenCalledWith(
        5,
        { comment: null },
        superadmin.id,
      );
    });
  });

  describe('lists', () => {
    it('maps a page of debts to DTOs', async () => {
      debts.list.mockResolvedValue(
        new Page([debt({ remaining: 0 })], {
          total: 1,
          page: 1,
          limit: 20,
          pages: 1,
        }),
      );
      const query = Object.assign(new ListDebtsQueryDto(), {
        sortBy: DebtSortField.Remaining,
        sortOrder: SortOrder.Asc,
      });

      const page = await controller.list(query);

      expect(debts.list).toHaveBeenCalledWith(query);
      expect(page).toBeInstanceOf(Page);
      expect(page.items[0].repaid).toBe(true);
      expect(page.meta.total).toBe(1);
    });

    it('maps the events of a debt, with no actor for an automatic one', async () => {
      debts.listEvents.mockResolvedValue(
        new Page(
          [
            {
              id: 2,
              debtId: 5,
              type: DebtEventType.AutoWriteOff,
              amount: 400,
              actor: null,
              actorUserId: null,
              balanceOperationId: 31,
              createdAt: new Date('2026-10-25T00:00:00Z'),
            } as DebtEvent,
          ],
          { total: 1, page: 1, limit: 20, pages: 1 },
        ),
      );
      const query = Object.assign(new ListDebtEventsQueryDto(), {
        sortBy: DebtEventSortField.CreatedAt,
      });

      const page = await controller.events(5, query);

      expect(debts.listEvents).toHaveBeenCalledWith(5, query);
      expect(page.items).toEqual([
        {
          id: 2,
          debtId: 5,
          type: DebtEventType.AutoWriteOff,
          amount: 400,
          actor: null,
          balanceOperationId: 31,
          createdAt: new Date('2026-10-25T00:00:00Z'),
        },
      ]);
    });
  });
});
