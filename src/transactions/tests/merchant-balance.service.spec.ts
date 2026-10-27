import { BadRequestException, ConflictException } from '@nestjs/common';
import { FindOperator, In } from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toCrypto } from '../../common/utils/to-crypto';
import { MerchantBalanceOperation } from '../entities/merchant-balance-operation.entity';
import { MerchantBalance } from '../entities/merchant-balance.entity';
import { MerchantBalanceService } from '../services/merchant-balance.service';
import { MerchantBalanceOperationType } from '../types/merchant-balance-operation-type.enum';

describe('MerchantBalanceService', () => {
  const MERCHANT = uuidOf(3);
  const DEAL = uuidOf(50);
  const ACTOR = uuidOf(9);

  type StoredOperation = Partial<MerchantBalanceOperation> & {
    transactionId: string | null;
    type: MerchantBalanceOperationType;
  };

  const typesOf = (type: unknown): MerchantBalanceOperationType[] =>
    type instanceof FindOperator
      ? (type.value as MerchantBalanceOperationType[])
      : [type as MerchantBalanceOperationType];

  const build = (stored: MerchantBalance | null) => {
    const journal: StoredOperation[] = [];
    const matching = (where: { transactionId: string; type: unknown }) =>
      journal.filter(
        (row) =>
          row.transactionId === where.transactionId &&
          typesOf(where.type).includes(row.type),
      );
    const insert = {
      insert: jest.fn(() => insert),
      into: jest.fn(() => insert),
      values: jest.fn(() => insert),
      orIgnore: jest.fn(() => insert),
      execute: jest.fn(async () => undefined),
    };
    const manager = {
      createQueryBuilder: jest.fn(() => insert),
      findOne: jest.fn(
        async (
          entity: unknown,
          options: { where: { transactionId: string; type: unknown } },
        ) =>
          entity === MerchantBalance
            ? stored
            : (matching(options.where)[0] ?? null),
      ),
      count: jest.fn(
        async (
          _entity: unknown,
          options: { where: { transactionId: string; type: unknown } },
        ) => matching(options.where).length,
      ),
      save: jest.fn(async (row: object) => {
        if (row === stored) return row;

        const saved = { id: 31 + journal.length, ...row } as StoredOperation;
        journal.push(saved);

        return saved;
      }),
      create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
    };
    const repository = {
      find: jest.fn(async () => (stored ? [stored] : [])),
      findOne: jest.fn(async () => stored),
    };
    const operations = {
      findAndCount: jest.fn(async () => [[{ id: 1 }], 1]),
      find: jest.fn(async () => [{ id: 1 }]),
    };
    const dataSource = {
      transaction: jest.fn(async (work: (m: typeof manager) => unknown) =>
        work(manager),
      ),
      getRepository: jest.fn(() => operations),
    };
    const audit = { record: jest.fn(async () => undefined) };

    return {
      manager,
      insert,
      journal,
      repository,
      operations,
      audit,
      service: new MerchantBalanceService(
        repository as never,
        dataSource as never,
        audit as never,
      ),
    };
  };

  const never = async () => false;
  const always = async () => true;

  const balance = (amount: number, escrow = 0) =>
    ({
      id: 7,
      merchantId: MERCHANT,
      balance: toCrypto(amount),
      escrow: toCrypto(escrow),
    }) as MerchantBalance;

  it('creates the row if missing, locks it and credits a pay-in with a journal row', async () => {
    const { manager, insert, service } = build(balance(10));

    const operation = await service.creditDealWithin(
      manager as never,
      MERCHANT,
      toCrypto(90.5),
      DEAL,
    );

    expect(insert.into).toHaveBeenCalledWith(MerchantBalance);
    expect(insert.values).toHaveBeenCalledWith({ merchantId: MERCHANT });
    expect(insert.orIgnore).toHaveBeenCalled();
    expect(manager.findOne).toHaveBeenCalledWith(MerchantBalance, {
      where: { merchantId: MERCHANT },
      lock: { mode: 'pessimistic_write' },
    });
    expect(manager.create).toHaveBeenCalledWith(MerchantBalanceOperation, {
      merchantBalanceId: 7,
      type: MerchantBalanceOperationType.DealPayIn,
      transactionId: DEAL,
      amount: toCrypto(90.5),
      balanceBefore: toCrypto(10),
      balanceAfter: toCrypto(100.5),
      escrowBefore: toCrypto(0),
      escrowAfter: toCrypto(0),
      comment: null,
      actorUserId: null,
    });
    expect(operation.balanceAfter).toEqual(toCrypto(100.5));
  });

  describe('holding a pay-out', () => {
    it('moves the amount from the balance into escrow', async () => {
      const stored = balance(100);
      const { manager, service } = build(stored);

      const operation = await service.holdPayOutWithin(
        manager as never,
        MERCHANT,
        toCrypto(40),
        DEAL,
        never,
      );

      expect(operation.type).toBe(
        MerchantBalanceOperationType.DealPayOutEscrow,
      );
      expect(operation.amount).toEqual(toCrypto(-40));
      expect(operation.balanceBefore).toEqual(toCrypto(100));
      expect(operation.balanceAfter).toEqual(toCrypto(60));
      expect(operation.escrowBefore).toEqual(toCrypto(0));
      expect(operation.escrowAfter).toEqual(toCrypto(40));
      expect(stored.escrow).toEqual(toCrypto(40));
    });

    it('asks for the overdraft only after the row is locked, and only when the balance falls short', async () => {
      const { manager, service } = build(balance(100));
      const allowsOverdraft = jest.fn(async () => false);

      await service.holdPayOutWithin(
        manager as never,
        MERCHANT,
        toCrypto(40),
        DEAL,
        allowsOverdraft,
      );

      expect(allowsOverdraft).not.toHaveBeenCalled();

      const short = build(balance(10));
      const asked = jest.fn(async () => {
        expect(short.manager.findOne).toHaveBeenCalledWith(MerchantBalance, {
          where: { merchantId: MERCHANT },
          lock: { mode: 'pessimistic_write' },
        });

        return true;
      });

      await short.service.holdPayOutWithin(
        short.manager as never,
        MERCHANT,
        toCrypto(40),
        DEAL,
        asked,
      );

      expect(asked).toHaveBeenCalledTimes(1);
    });

    it('refuses with a 409 and writes nothing when the balance does not cover it without overdraft', async () => {
      const stored = balance(10);
      const { manager, service } = build(stored);

      await expect(
        service.holdPayOutWithin(
          manager as never,
          MERCHANT,
          toCrypto(40),
          DEAL,
          never,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(manager.save).not.toHaveBeenCalled();
      expect(stored.balance).toEqual(toCrypto(10));
    });

    it('takes the balance below zero with overdraft on', async () => {
      const stored = balance(10);
      const { manager, service } = build(stored);

      const operation = await service.holdPayOutWithin(
        manager as never,
        MERCHANT,
        toCrypto(40),
        DEAL,
        always,
      );

      expect(operation.balanceAfter).toEqual(toCrypto(-30));
      expect(stored.escrow).toEqual(toCrypto(40));
    });

    it('lets an exact balance through', async () => {
      const { manager, service } = build(balance(40));

      const operation = await service.holdPayOutWithin(
        manager as never,
        MERCHANT,
        toCrypto(40),
        DEAL,
        never,
      );

      expect(operation.balanceAfter).toEqual(toCrypto(0));
    });
  });

  describe('settling a pay-out', () => {
    it('takes a held deal out of escrow: the available balance does not move and the amount is zero', async () => {
      const stored = balance(100);
      const { manager, service } = build(stored);

      await service.holdPayOutWithin(
        manager as never,
        MERCHANT,
        toCrypto(40),
        DEAL,
        never,
      );
      const operation = await service.settlePayOutWithin(
        manager as never,
        MERCHANT,
        toCrypto(40),
        DEAL,
      );

      expect(operation?.type).toBe(MerchantBalanceOperationType.DealPayOut);
      expect(operation?.amount).toEqual(toCrypto(0));
      expect(operation?.balanceBefore).toEqual(toCrypto(60));
      expect(operation?.balanceAfter).toEqual(toCrypto(60));
      expect(operation?.escrowBefore).toEqual(toCrypto(40));
      expect(operation?.escrowAfter).toEqual(toCrypto(0));
      expect(stored.escrow).toEqual(toCrypto(0));
    });

    it('takes out of escrow what was held, not the figure it is handed', async () => {
      const stored = balance(100);
      const { manager, service } = build(stored);

      await service.holdPayOutWithin(
        manager as never,
        MERCHANT,
        toCrypto(40),
        DEAL,
        never,
      );
      await service.settlePayOutWithin(
        manager as never,
        MERCHANT,
        toCrypto(55),
        DEAL,
      );

      expect(stored.escrow).toEqual(toCrypto(0));
      expect(stored.balance).toEqual(toCrypto(60));
    });

    it('debits the available balance for a deal created before escrow, below zero if need be', async () => {
      const stored = balance(10);
      const { manager, service } = build(stored);

      const operation = await service.settlePayOutWithin(
        manager as never,
        MERCHANT,
        toCrypto(25),
        DEAL,
      );

      expect(operation?.amount).toEqual(toCrypto(-25));
      expect(operation?.balanceAfter).toEqual(toCrypto(-15));
      expect(stored.escrow).toEqual(toCrypto(0));
    });

    it('settles once: a second settle or a release after it moves nothing', async () => {
      const stored = balance(100);
      const { manager, service, journal } = build(stored);

      await service.holdPayOutWithin(
        manager as never,
        MERCHANT,
        toCrypto(40),
        DEAL,
        never,
      );
      await service.settlePayOutWithin(
        manager as never,
        MERCHANT,
        toCrypto(40),
        DEAL,
      );

      expect(
        await service.settlePayOutWithin(
          manager as never,
          MERCHANT,
          toCrypto(40),
          DEAL,
        ),
      ).toBeNull();
      expect(
        await service.releasePayOutWithin(manager as never, MERCHANT, DEAL),
      ).toBeNull();
      expect(journal).toHaveLength(2);
      expect(stored.balance).toEqual(toCrypto(60));
      expect(stored.escrow).toEqual(toCrypto(0));
    });
  });

  describe('releasing a pay-out', () => {
    it('returns the held amount from escrow to the balance', async () => {
      const stored = balance(100);
      const { manager, service } = build(stored);

      await service.holdPayOutWithin(
        manager as never,
        MERCHANT,
        toCrypto(40),
        DEAL,
        never,
      );
      const operation = await service.releasePayOutWithin(
        manager as never,
        MERCHANT,
        DEAL,
      );

      expect(operation?.type).toBe(
        MerchantBalanceOperationType.DealPayOutEscrowRelease,
      );
      expect(operation?.amount).toEqual(toCrypto(40));
      expect(operation?.balanceAfter).toEqual(toCrypto(100));
      expect(operation?.escrowAfter).toEqual(toCrypto(0));
      expect(stored.escrow).toEqual(toCrypto(0));
    });

    it('moves nothing for a deal that was never held', async () => {
      const stored = balance(60);
      const { manager, service } = build(stored);

      expect(
        await service.releasePayOutWithin(manager as never, MERCHANT, DEAL),
      ).toBeNull();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('releases once: a second release or a settle after it moves nothing', async () => {
      const stored = balance(100);
      const { manager, service, journal } = build(stored);

      await service.holdPayOutWithin(
        manager as never,
        MERCHANT,
        toCrypto(40),
        DEAL,
        never,
      );
      await service.releasePayOutWithin(manager as never, MERCHANT, DEAL);

      expect(
        await service.releasePayOutWithin(manager as never, MERCHANT, DEAL),
      ).toBeNull();
      expect(
        await service.settlePayOutWithin(
          manager as never,
          MERCHANT,
          toCrypto(40),
          DEAL,
        ),
      ).toBeNull();
      expect(journal).toHaveLength(2);
      expect(stored.balance).toEqual(toCrypto(100));
      expect(stored.escrow).toEqual(toCrypto(0));
    });
  });

  describe('the journal adds up', () => {
    it('every row: amount is the change of the available balance and the escrow figures chain', async () => {
      const stored = balance(50);
      const { manager, service, journal } = build(stored);
      const other = uuidOf(51);
      const third = uuidOf(52);

      await service.creditDealWithin(
        manager as never,
        MERCHANT,
        toCrypto(30),
        uuidOf(60),
      );
      await service.holdPayOutWithin(
        manager as never,
        MERCHANT,
        toCrypto(20),
        DEAL,
        never,
      );
      await service.holdPayOutWithin(
        manager as never,
        MERCHANT,
        toCrypto(15),
        other,
        never,
      );
      await service.settlePayOutWithin(
        manager as never,
        MERCHANT,
        toCrypto(20),
        DEAL,
      );
      await service.releasePayOutWithin(manager as never, MERCHANT, other);
      await service.settlePayOutWithin(
        manager as never,
        MERCHANT,
        toCrypto(5),
        third,
      );
      await service.adjust({
        merchantId: MERCHANT,
        direction: 'debit',
        amount: toCrypto(1.5),
        comment: 'fix',
        actorUserId: ACTOR,
      });

      for (const row of journal) {
        expect(row.amount).toEqual(
          toCrypto(row.balanceAfter!.minus(row.balanceBefore!)),
        );
      }
      for (let index = 1; index < journal.length; index += 1) {
        expect(journal[index].balanceBefore).toEqual(
          journal[index - 1].balanceAfter,
        );
        expect(journal[index].escrowBefore).toEqual(
          journal[index - 1].escrowAfter,
        );
      }
      expect(stored.balance).toEqual(toCrypto(53.5));
      expect(stored.escrow).toEqual(toCrypto(0));
    });
  });

  describe('adjusting by hand', () => {
    it('credits with the comment and actor on the journal row and an audit row in the same transaction', async () => {
      const { manager, service, audit } = build(balance(10));

      const operation = await service.adjust({
        merchantId: MERCHANT,
        direction: 'credit',
        amount: toCrypto(5),
        comment: 'correction',
        actorUserId: ACTOR,
      });

      expect(operation.type).toBe(MerchantBalanceOperationType.AdminAdjustment);
      expect(operation.transactionId).toBeNull();
      expect(operation.comment).toBe('correction');
      expect(operation.actorUserId).toBe(ACTOR);
      expect(operation.balanceAfter).toEqual(toCrypto(15));
      expect(audit.record).toHaveBeenCalledWith(
        {
          actorUserId: ACTOR,
          action: 'merchant.balance_adjusted',
          metadata: {
            merchantId: MERCHANT,
            operationId: 31,
            amount: '5.000000',
            balanceBefore: '10.000000',
            balanceAfter: '15.000000',
            comment: 'correction',
          },
        },
        manager,
      );
    });

    it('debits below zero', async () => {
      const { service } = build(balance(10));

      const operation = await service.adjust({
        merchantId: MERCHANT,
        direction: 'debit',
        amount: toCrypto(25),
        comment: 'fee',
        actorUserId: ACTOR,
      });

      expect(operation.amount).toEqual(toCrypto(-25));
      expect(operation.balanceAfter).toEqual(toCrypto(-15));
    });
  });

  describe('reading', () => {
    it('reads every balance in one query and answers zero for a merchant without a row', async () => {
      const { repository, service } = build(balance(42, 3));

      const result = await service.statesByMerchant([MERCHANT, uuidOf(4)]);

      expect(repository.find).toHaveBeenCalledWith({
        where: { merchantId: In([MERCHANT, uuidOf(4)]) },
      });
      expect(result.get(MERCHANT)).toEqual({
        balance: toCrypto(42),
        escrow: toCrypto(3),
      });
      expect(result.get(uuidOf(4))).toEqual({
        balance: toCrypto(0),
        escrow: toCrypto(0),
      });
      expect(
        (await service.balancesByMerchant([MERCHANT])).get(MERCHANT),
      ).toEqual(toCrypto(42));
    });

    it('asks nothing for no merchant', async () => {
      const { repository, service } = build(balance(0));

      expect((await service.balancesByMerchant([])).size).toBe(0);
      expect(repository.find).not.toHaveBeenCalled();
    });

    it('lists the journal of the merchant’s balance with the filters, newest first', async () => {
      const { operations, service } = build(balance(0));
      const from = new Date('2026-10-01T00:00:00Z');

      const page = await service.listOperations({
        merchantId: MERCHANT,
        from,
        types: [MerchantBalanceOperationType.AdminAdjustment],
        page: 2,
        limit: 10,
        sortOrder: SortOrder.Desc,
      });

      expect(operations.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            merchantBalanceId: 7,
            type: In([MerchantBalanceOperationType.AdminAdjustment]),
          }),
          order: { createdAt: 'DESC', id: 'DESC' },
          skip: 10,
          take: 10,
        }),
      );
      expect(page.meta.total).toBe(1);
    });

    it('answers an empty page for a merchant without a balance row', async () => {
      const { operations, service } = build(null);

      const page = await service.listOperations({
        merchantId: MERCHANT,
        page: 1,
        limit: 20,
        sortOrder: SortOrder.Desc,
      });

      expect(page.items).toEqual([]);
      expect(operations.findAndCount).not.toHaveBeenCalled();
      expect(
        await service.exportOperations({ merchantId: MERCHANT }, 5),
      ).toEqual([]);
    });

    it('refuses an export above the cap with a 400', async () => {
      const { operations, service } = build(balance(0));
      operations.find.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);

      await expect(
        service.exportOperations({ merchantId: MERCHANT }, 1),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(operations.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 2 }),
      );
    });
  });
});
