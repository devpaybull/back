import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { In, LessThanOrEqual, MoreThan } from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { BalanceOperation } from '../../transactions/entities/balance-operation.entity';
import { Wallet } from '../../transactions/entities/wallet.entity';
import { WalletService } from '../../transactions/services/wallet.service';
import { BalanceOperationType } from '../../transactions/types/balance-operation-type.enum';
import { DebtEvent } from '../entities/debt-event.entity';
import { Debt } from '../entities/debt.entity';
import { DebtsService } from '../services/debts.service';
import { DebtEventSortField } from '../types/debt-event-sort-field.enum';
import { DebtEventType } from '../types/debt-event-type.enum';
import { DebtListQuery } from '../types/debt-list-query';
import { DebtSortField } from '../types/debt-sort-field.enum';
import { DebtStatus } from '../types/debt-status.enum';

type Entity =
  typeof Wallet | typeof Debt | typeof DebtEvent | typeof BalanceOperation;

const DEBTOR = uuidOf(1);
const ISSUER = uuidOf(9);
const NOW = new Date('2026-10-25T00:00:00Z');

const build = () => {
  const store = new Map<Entity, Record<string, any>[]>([
    [Wallet, []],
    [Debt, []],
    [DebtEvent, []],
    [BalanceOperation, []],
  ]);
  const kinds = new WeakMap<object, Entity>();
  const locked = new Set<number>();
  const rows = <T>(entity: Entity) => store.get(entity) as T[];

  const insert = {
    insert: () => insert,
    into: () => insert,
    values: (values: { userId: string }) => {
      if (!rows<Wallet>(Wallet).some((w) => w.userId === values.userId)) {
        rows<Partial<Wallet>>(Wallet).push({
          id: rows(Wallet).length + 1,
          userId: values.userId,
          mainBalance: 0,
          mainReserved: 0,
        });
      }
      return insert;
    },
    orIgnore: () => insert,
    execute: jest.fn(async () => undefined),
  };

  const dueQuery = (debtId: number, now: Date) =>
    rows<Debt>(Debt).find(
      (debt) =>
        debt.id === debtId &&
        !locked.has(debt.id) &&
        debt.autoWriteOffAt !== null &&
        debt.autoWriteOffAt <= now &&
        !debt.autoWriteOffPaused &&
        debt.remaining > 0,
    ) ?? null;

  const queryBuilder = () => {
    const params: { debtId?: number; now?: Date } = {};
    const builder = {
      where: (_sql: string, values: { debtId: number }) => {
        params.debtId = values.debtId;
        return builder;
      },
      andWhere: (_sql: string, values?: { now: Date }) => {
        if (values?.now) params.now = values.now;
        return builder;
      },
      setLock: jest.fn(() => builder),
      setOnLocked: jest.fn(() => builder),
      getOne: async () => dueQuery(params.debtId, params.now),
    };
    return builder;
  };

  const manager = {
    createQueryBuilder: () => insert,
    getRepository: jest.fn(() => ({ createQueryBuilder: queryBuilder })),
    findOne: jest.fn(
      async (entity: Entity, options: { where: Record<string, unknown> }) =>
        rows<Record<string, unknown>>(entity).find((row) =>
          Object.entries(options.where).every(([k, v]) => row[k] === v),
        ) ?? null,
    ),
    create: jest.fn((entity: Entity, data: object) => {
      const row = { ...data };
      kinds.set(row, entity);
      return row;
    }),
    update: jest.fn(
      async (
        entity: Entity,
        criteria: Record<string, unknown>,
        patch: Record<string, unknown>,
      ) => {
        for (const row of rows<Record<string, unknown>>(entity)) {
          if (Object.entries(criteria).every(([k, v]) => row[k] === v)) {
            Object.assign(row, patch);
          }
        }
      },
    ),
    save: jest.fn(async (row: Record<string, any>) => {
      const entity = kinds.get(row) ?? ('mainBalance' in row ? Wallet : Debt);
      const table = rows<Record<string, any>>(entity);
      if (row.id === undefined) {
        row.id = table.length + 1;
        row.createdAt = new Date();
      }
      if (!table.includes(row)) table.push(row);
      return row;
    }),
  };

  const dataSource = {
    transaction: jest.fn(async (work: (m: typeof manager) => unknown) => {
      const snapshot = new Map(
        [...store].map(([entity, table]) => [
          entity,
          table.map((row) => ({ ...row })),
        ]),
      );
      try {
        return await work(manager);
      } catch (error) {
        for (const [entity, table] of snapshot) {
          const live = rows<Record<string, any>>(entity);
          live.splice(0, live.length);
          for (const copy of table) {
            const original = live.find((r) => r.id === copy.id);
            live.push(original ? Object.assign(original, copy) : copy);
          }
        }
        throw error;
      }
    }),
  };

  const debts = {
    findOne: jest.fn(
      async ({ where }: { where: { id: number } }) =>
        rows<Debt>(Debt).find((debt) => debt.id === where.id) ?? null,
    ),
    find: jest.fn(async () => []),
    findAndCount: jest.fn(async () => [[], 0]),
    merge: jest.fn((target: object, patch: object) =>
      Object.assign(target, patch),
    ),
    save: jest.fn(async (row: object) => row),
  };
  const events = {
    findAndCount: jest.fn(async () => [[], 0]),
    find: jest.fn(async () => [] as Partial<DebtEvent>[]),
  };
  const directory = { findIdsMatching: jest.fn(async () => [] as string[]) };
  const audit = { record: jest.fn(async () => ({})) };

  const wallets = new WalletService(
    {} as never,
    dataSource as never,
    {} as never,
    {} as never,
  );
  const service = new DebtsService(
    debts as never,
    events as never,
    dataSource as never,
    wallets,
    directory as never,
    audit as never,
  );

  const wallet = () => rows<Wallet>(Wallet).find((w) => w.userId === DEBTOR);

  return {
    service,
    manager,
    dataSource,
    debts,
    events,
    directory,
    audit,
    locked,
    rows,
    wallet,
  };
};

describe('DebtsService', () => {
  describe('issue', () => {
    it('credits the main balance, opens a debt and logs it, all in one transaction', async () => {
      const t = build();

      const debt = await t.service.issue(DEBTOR, 400, ISSUER);

      expect(t.dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(t.wallet().mainBalance).toBe(400);
      expect(t.rows<BalanceOperation>(BalanceOperation)).toEqual([
        expect.objectContaining({
          type: BalanceOperationType.DebtIssued,
          amount: 400,
          balanceBefore: 0,
          balanceAfter: 400,
          transactionId: null,
        }),
      ]);
      expect(debt).toEqual(
        expect.objectContaining({
          userId: DEBTOR,
          issuedByUserId: ISSUER,
          amount: 400,
          remaining: 400,
          comment: null,
          autoWriteOffAt: null,
          autoWriteOffPaused: false,
        }),
      );
      expect(t.rows<DebtEvent>(DebtEvent)).toEqual([
        expect.objectContaining({
          debtId: debt.id,
          type: DebtEventType.Issued,
          amount: 400,
          actorUserId: ISSUER,
          balanceOperationId: 1,
        }),
      ]);
      expect(t.audit.record).toHaveBeenCalledWith(
        {
          actorUserId: ISSUER,
          targetUserId: DEBTOR,
          action: 'debt.issued',
          metadata: { debtId: debt.id, amount: 400, balanceOperationId: 1 },
        },
        t.manager,
      );
    });

    it('opens a separate debt for every issuance', async () => {
      const t = build();

      await t.service.issue(DEBTOR, 100, ISSUER);
      await t.service.issue(DEBTOR, 50, ISSUER);

      expect(t.rows<Debt>(Debt)).toHaveLength(2);
      expect(t.wallet().mainBalance).toBe(150);
    });

    it('writes nothing when the audit row fails', async () => {
      const t = build();
      t.audit.record.mockRejectedValueOnce(new Error('db down'));

      await expect(t.service.issue(DEBTOR, 100, ISSUER)).rejects.toThrow(
        'db down',
      );
      expect(t.rows(Debt)).toHaveLength(0);
      expect(t.rows(DebtEvent)).toHaveLength(0);
    });
  });

  describe('writeOff', () => {
    const issued = async (amount = 400) => {
      const t = build();
      const debt = await t.service.issue(DEBTOR, amount, ISSUER);
      t.audit.record.mockClear();
      return { ...t, debt };
    };

    it('withholds part of the debt from the main balance under a lock on the debt', async () => {
      const t = await issued();

      const debt = await t.service.writeOff(t.debt.id, 150.5, ISSUER);

      expect(t.manager.findOne).toHaveBeenCalledWith(Debt, {
        where: { id: t.debt.id },
        lock: { mode: 'pessimistic_write' },
      });
      expect(debt.remaining).toBe(249.5);
      expect(t.wallet().mainBalance).toBe(249.5);
      expect(t.rows<BalanceOperation>(BalanceOperation)[1]).toEqual(
        expect.objectContaining({
          type: BalanceOperationType.DebtWriteOff,
          amount: -150.5,
          balanceBefore: 400,
          balanceAfter: 249.5,
        }),
      );
      expect(t.rows<DebtEvent>(DebtEvent)[1]).toEqual(
        expect.objectContaining({
          type: DebtEventType.ManualWriteOff,
          amount: 150.5,
          actorUserId: ISSUER,
          balanceOperationId: 2,
        }),
      );
      expect(t.audit.record).toHaveBeenCalledWith(
        {
          actorUserId: ISSUER,
          targetUserId: DEBTOR,
          action: 'debt.written_off',
          metadata: {
            debtId: t.debt.id,
            amount: 150.5,
            remaining: 249.5,
            balanceOperationId: 2,
          },
        },
        t.manager,
      );
    });

    it('withholds the whole remaining debt when no amount is given', async () => {
      const t = await issued();
      await t.service.writeOff(t.debt.id, 100, ISSUER);

      const debt = await t.service.writeOff(t.debt.id, undefined, ISSUER);

      expect(debt.remaining).toBe(0);
      expect(t.rows<DebtEvent>(DebtEvent)[2].amount).toBe(300);
      expect(t.wallet().mainBalance).toBe(0);
    });

    it('lets the main balance go negative', async () => {
      const t = await issued();
      t.wallet().mainBalance = 30;

      await t.service.writeOff(t.debt.id, undefined, ISSUER);

      expect(t.wallet().mainBalance).toBe(-370);
    });

    it('refuses more than remains with a 400 and moves nothing', async () => {
      const t = await issued();

      await expect(
        t.service.writeOff(t.debt.id, 400.001, ISSUER),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(t.wallet().mainBalance).toBe(400);
      expect(t.rows(DebtEvent)).toHaveLength(1);
      expect(t.audit.record).not.toHaveBeenCalled();
    });

    it('refuses a repaid debt with a 409', async () => {
      const t = await issued();
      await t.service.writeOff(t.debt.id, undefined, ISSUER);

      await expect(
        t.service.writeOff(t.debt.id, undefined, ISSUER),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        t.service.writeOff(t.debt.id, 1, ISSUER),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('404 for an unknown debt', async () => {
      const t = build();

      await expect(
        t.service.writeOff(77, undefined, ISSUER),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('auto write-off', () => {
    const scheduled = async (overrides: Partial<Debt> = {}) => {
      const t = build();
      const debt = await t.service.issue(DEBTOR, 400, ISSUER);
      Object.assign(t.rows<Debt>(Debt)[0], {
        autoWriteOffAt: new Date('2026-10-24T21:00:00Z'),
        ...overrides,
      });
      t.audit.record.mockClear();
      return { ...t, debt };
    };

    it('asks for due, unpaused, unpaid debts in due order', async () => {
      const t = build();
      t.debts.find.mockResolvedValue([{ id: 3 }, { id: 8 }]);

      await expect(t.service.findDueIds(NOW, 100)).resolves.toEqual([3, 8]);
      expect(t.debts.find).toHaveBeenCalledWith({
        select: { id: true },
        where: {
          autoWriteOffAt: LessThanOrEqual(NOW),
          autoWriteOffPaused: false,
          remaining: MoreThan(0),
        },
        order: { autoWriteOffAt: 'ASC', id: 'ASC' },
        take: 100,
      });
    });

    it('withholds the whole remaining debt with no actor, going negative, and clears the moment', async () => {
      const t = await scheduled();
      t.wallet().mainBalance = 100;

      await expect(t.service.autoWriteOff(t.debt.id, NOW)).resolves.toBe(true);

      const debt = t.rows<Debt>(Debt)[0];
      expect(debt.remaining).toBe(0);
      expect(debt.autoWriteOffAt).toBeNull();
      expect(t.wallet().mainBalance).toBe(-300);
      expect(t.rows<DebtEvent>(DebtEvent)[1]).toEqual(
        expect.objectContaining({
          type: DebtEventType.AutoWriteOff,
          amount: 400,
          actorUserId: null,
          balanceOperationId: 2,
        }),
      );
      expect(t.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: null,
          targetUserId: DEBTOR,
          action: 'debt.auto_written_off',
        }),
        t.manager,
      );
    });

    it('takes the debt with FOR UPDATE SKIP LOCKED', async () => {
      const t = await scheduled();
      const builder = { setLock: jest.fn(), setOnLocked: jest.fn() };
      const original = t.manager.getRepository.getMockImplementation();
      t.manager.getRepository.mockImplementation(() => {
        const repository = original();
        return {
          createQueryBuilder: () => {
            const qb = repository.createQueryBuilder();
            builder.setLock = qb.setLock;
            builder.setOnLocked = qb.setOnLocked;
            return qb;
          },
        };
      });

      await t.service.autoWriteOff(t.debt.id, NOW);

      expect(builder.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(builder.setOnLocked).toHaveBeenCalledWith('skip_locked');
    });

    it.each([
      ['not yet due', { autoWriteOffAt: new Date('2026-10-26T00:00:00Z') }],
      ['paused', { autoWriteOffPaused: true }],
      ['without a moment', { autoWriteOffAt: null }],
      ['already repaid', { remaining: 0 }],
    ])('moves nothing for a debt %s', async (_label, overrides) => {
      const t = await scheduled(overrides);

      await expect(t.service.autoWriteOff(t.debt.id, NOW)).resolves.toBe(false);
      expect(t.wallet().mainBalance).toBe(400);
      expect(t.rows(DebtEvent)).toHaveLength(1);
      expect(t.audit.record).not.toHaveBeenCalled();
    });

    it('skips a debt another instance holds locked', async () => {
      const t = await scheduled();
      t.locked.add(t.debt.id);

      await expect(t.service.autoWriteOff(t.debt.id, NOW)).resolves.toBe(false);
      expect(t.wallet().mainBalance).toBe(400);
    });

    it('writes a debt off once when two runs reach it one after the other', async () => {
      const t = await scheduled();

      const results = [
        await t.service.autoWriteOff(t.debt.id, NOW),
        await t.service.autoWriteOff(t.debt.id, NOW),
      ];

      expect(results).toEqual([true, false]);
      expect(t.wallet().mainBalance).toBe(0);
      expect(
        t
          .rows<DebtEvent>(DebtEvent)
          .filter((event) => event.type === DebtEventType.AutoWriteOff),
      ).toHaveLength(1);
    });
  });

  describe('update', () => {
    const existing = async () => {
      const t = build();
      const debt = await t.service.issue(DEBTOR, 400, ISSUER);
      t.rows<Debt>(Debt)[0].comment = 'old';
      t.rows<Debt>(Debt)[0].autoWriteOffAt = new Date('2026-11-01T00:00:00Z');
      t.audit.record.mockClear();
      return { ...t, debt };
    };

    it('changes only the fields given', async () => {
      const t = await existing();

      const debt = await t.service.update(
        t.debt.id,
        {
          autoWriteOffPaused: true,
        },
        ISSUER,
      );

      expect(debt.comment).toBe('old');
      expect(debt.autoWriteOffAt).toEqual(new Date('2026-11-01T00:00:00Z'));
      expect(debt.autoWriteOffPaused).toBe(true);
    });

    it('deletes the comment and removes the moment on null', async () => {
      const t = await existing();

      const debt = await t.service.update(
        t.debt.id,
        {
          comment: null,
          autoWriteOffAt: null,
        },
        ISSUER,
      );

      expect(debt.comment).toBeNull();
      expect(debt.autoWriteOffAt).toBeNull();
    });

    it('moves no money', async () => {
      const t = await existing();

      await t.service.update(t.debt.id, { comment: 'new' }, ISSUER);

      expect(t.wallet().mainBalance).toBe(400);
      expect(t.rows(BalanceOperation)).toHaveLength(1);
    });

    it('locks the debt in a transaction, as the write-offs do', async () => {
      const t = await existing();
      t.dataSource.transaction.mockClear();

      await t.service.update(t.debt.id, { comment: 'new' }, ISSUER);

      expect(t.dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(t.manager.findOne).toHaveBeenCalledWith(Debt, {
        where: { id: t.debt.id },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('does not restore what a write-off changed between the read and the write', async () => {
      const t = await existing();
      const live = t.rows<Debt>(Debt)[0];
      t.manager.findOne.mockImplementationOnce(async () => {
        const stale = { ...live };
        live.remaining = 0;
        live.autoWriteOffAt = null;
        return stale;
      });

      await t.service.update(t.debt.id, { comment: 'new' }, ISSUER);

      expect(live.comment).toBe('new');
      expect(live.remaining).toBe(0);
      expect(live.autoWriteOffAt).toBeNull();
    });

    it('records debt.updated with the changed fields in the same transaction', async () => {
      const t = await existing();

      await t.service.update(
        t.debt.id,
        { comment: 'new', autoWriteOffPaused: true },
        ISSUER,
      );

      expect(t.audit.record).toHaveBeenCalledWith(
        {
          actorUserId: ISSUER,
          targetUserId: DEBTOR,
          action: 'debt.updated',
          metadata: {
            debtId: t.debt.id,
            comment: 'new',
            autoWriteOffPaused: true,
          },
        },
        t.manager,
      );
    });

    it('changes nothing when the audit row fails', async () => {
      const t = await existing();
      t.audit.record.mockRejectedValueOnce(new Error('audit down'));

      await expect(
        t.service.update(t.debt.id, { comment: 'new' }, ISSUER),
      ).rejects.toThrow('audit down');
      expect(t.rows<Debt>(Debt)[0].comment).toBe('old');
    });

    it('404 for an unknown debt', async () => {
      const t = build();

      await expect(
        t.service.update(77, { comment: 'x' }, ISSUER),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('list', () => {
    const query = (overrides: Partial<DebtListQuery> = {}): DebtListQuery => ({
      page: 1,
      limit: 20,
      sortBy: DebtSortField.CreatedAt,
      sortOrder: SortOrder.Desc,
      ...overrides,
    });

    const lastCall = (t: ReturnType<typeof build>) => {
      const calls = t.debts.findAndCount.mock.calls as unknown as [any][];
      return calls[calls.length - 1][0];
    };

    it('loads the debtor and the issuer in the same query, paged, tie-broken on id', async () => {
      const t = build();

      await t.service.list(query({ page: 3, limit: 10 }));

      expect(t.debts.findAndCount).toHaveBeenCalledTimes(1);
      expect(lastCall(t)).toEqual({
        where: [{}],
        relations: { user: true, issuedBy: true },
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: 20,
        take: 10,
      });
    });

    it.each([
      [DebtSortField.Remaining, SortOrder.Asc, { remaining: 'ASC', id: 'ASC' }],
      [DebtSortField.Amount, SortOrder.Desc, { amount: 'DESC', id: 'DESC' }],
    ])('sorts by %s %s', async (sortBy, sortOrder, order) => {
      const t = build();

      await t.service.list(query({ sortBy, sortOrder }));

      expect(lastCall(t).order).toEqual(order);
    });

    it('filters active debts as remaining above zero and repaid ones as zero', async () => {
      const t = build();

      await t.service.list(query({ status: DebtStatus.Active }));
      expect(lastCall(t).where).toEqual([{ remaining: MoreThan(0) }]);

      await t.service.list(query({ status: DebtStatus.Repaid }));
      expect(lastCall(t).where).toEqual([{ remaining: 0 }]);
    });

    it('filters by debtor', async () => {
      const t = build();

      await t.service.list(query({ userId: DEBTOR }));

      expect(lastCall(t).where).toEqual([{ userId: DEBTOR }]);
    });

    it('searches the debtor login through the users module and the debt id', async () => {
      const t = build();
      t.directory.findIdsMatching.mockResolvedValue([DEBTOR, uuidOf(2)]);

      await t.service.list(query({ search: '42', status: DebtStatus.Active }));

      expect(t.directory.findIdsMatching).toHaveBeenCalledWith('42');
      expect(lastCall(t).where).toEqual([
        { remaining: MoreThan(0), userId: In([DEBTOR, uuidOf(2)]) },
        { remaining: MoreThan(0), id: 42 },
      ]);
    });

    it('does not search the id with a term that is not a number', async () => {
      const t = build();
      t.directory.findIdsMatching.mockResolvedValue([DEBTOR]);

      await t.service.list(query({ search: 'durov' }));

      expect(lastCall(t).where).toEqual([{ userId: In([DEBTOR]) }]);
    });

    it('keeps the debtor filter when searching', async () => {
      const t = build();
      t.directory.findIdsMatching.mockResolvedValue([DEBTOR, uuidOf(2)]);

      await t.service.list(query({ search: 'a', userId: uuidOf(2) }));

      expect(lastCall(t).where).toEqual([{ userId: In([uuidOf(2)]) }]);
    });

    it('answers an empty page without querying when nothing can match', async () => {
      const t = build();

      const page = await t.service.list(query({ search: 'nobody' }));

      expect(t.debts.findAndCount).not.toHaveBeenCalled();
      expect(page.items).toEqual([]);
      expect(page.meta).toEqual({ total: 0, page: 1, limit: 20, pages: 0 });
    });

    it('does not search an id beyond the int column', async () => {
      const t = build();

      await t.service.list(query({ search: '99999999999' }));

      expect(t.debts.findAndCount).not.toHaveBeenCalled();
    });
  });

  describe('listEvents', () => {
    it('pages the events of one debt with their actor', async () => {
      const t = build();
      const debt = await t.service.issue(DEBTOR, 1, ISSUER);

      await t.service.listEvents(debt.id, {
        page: 2,
        limit: 5,
        sortBy: DebtEventSortField.CreatedAt,
        sortOrder: SortOrder.Desc,
      });

      expect(t.events.findAndCount).toHaveBeenCalledWith({
        where: { debtId: debt.id },
        relations: { actor: true },
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: 5,
        take: 5,
      });
    });

    it('orders by id alone when asked', async () => {
      const t = build();
      const debt = await t.service.issue(DEBTOR, 1, ISSUER);

      await t.service.listEvents(debt.id, {
        page: 1,
        limit: 5,
        sortBy: DebtEventSortField.Id,
        sortOrder: SortOrder.Asc,
      });

      expect(t.events.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ order: { id: 'ASC' } }),
      );
    });

    it('404 for an unknown debt', async () => {
      const t = build();

      await expect(
        t.service.listEvents(77, {
          page: 1,
          limit: 5,
          sortBy: DebtEventSortField.Id,
          sortOrder: SortOrder.Asc,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('debtIdsByBalanceOperation', () => {
    it('answers without querying for no ids', async () => {
      const t = build();

      await expect(t.service.debtIdsByBalanceOperation([])).resolves.toEqual(
        new Map(),
      );
      expect(t.events.find).not.toHaveBeenCalled();
    });

    it('maps every journal row to its debt in a single query', async () => {
      const t = build();
      t.events.find.mockResolvedValue([
        { debtId: 7, balanceOperationId: 11 },
        { debtId: 8, balanceOperationId: 12 },
      ]);

      const result = await t.service.debtIdsByBalanceOperation([11, 12, 13]);

      expect(result).toEqual(
        new Map([
          [11, 7],
          [12, 8],
        ]),
      );
      expect(t.events.find).toHaveBeenCalledTimes(1);
      expect(t.events.find).toHaveBeenCalledWith({
        where: { balanceOperationId: In([11, 12, 13]) },
        select: { debtId: true, balanceOperationId: true },
      });
    });
  });
});
