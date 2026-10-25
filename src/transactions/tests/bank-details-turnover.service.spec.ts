import { uuidOf } from '../../common/tests/uuid-of.spec';
import { BankDetailsTurnoverService } from '../services/bank-details-turnover.service';
import { TransactionStatus } from '../types/transaction-status.enum';

describe('BankDetailsTurnoverService', () => {
  const now = new Date('2026-03-10T22:30:00Z');

  const build = (
    rows: Record<string, string>[] = [],
    queryRows: { id: string }[] = [],
  ) => {
    const builder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(async () => rows),
    };
    const transactions = {
      createQueryBuilder: jest.fn(() => builder),
      query: jest.fn(async () => queryRows),
    };
    const config = {
      getOrThrow: jest.fn((key: string) =>
        key === 'BUSINESS_TIMEZONE' ? 'Europe/Moscow' : undefined,
      ),
    };

    return {
      service: new BankDetailsTurnoverService(
        transactions as never,
        config as never,
      ),
      builder,
      transactions,
    };
  };

  describe('turnoverOfBankDetails', () => {
    it('asks one grouped query for every id', async () => {
      const { service, transactions, builder } = build();

      await service.turnoverOfBankDetails([uuidOf(1), uuidOf(2)], now);

      expect(transactions.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(builder.groupBy).toHaveBeenCalledWith('transaction.bankDetailsId');
      expect(builder.where).toHaveBeenCalledWith(
        'transaction.bankDetailsId IN (:...ids)',
        { ids: [uuidOf(1), uuidOf(2)] },
      );
    });

    it('counts only success and success_changed', async () => {
      const { service, builder } = build();

      await service.turnoverOfBankDetails([uuidOf(1)], now);

      expect(builder.andWhere).toHaveBeenCalledWith(
        'transaction.status IN (:...statuses)',
        {
          statuses: [
            TransactionStatus.Success,
            TransactionStatus.SuccessChanged,
          ],
        },
      );
    });

    it('bounds today and the month by the calendar of the business timezone', async () => {
      const { service, builder } = build();

      await service.turnoverOfBankDetails([uuidOf(1)], now);

      expect(builder.setParameters).toHaveBeenCalledWith({
        dayStart: new Date('2026-03-10T21:00:00Z'),
        monthStart: new Date('2026-02-28T21:00:00Z'),
      });
    });

    it('buckets by the moment the deal succeeded', async () => {
      const { service, builder } = build();

      await service.turnoverOfBankDetails([uuidOf(1)], now);

      const sums = builder.addSelect.mock.calls
        .map(([expression]) => expression as string)
        .filter((expression) => expression.includes('CASE'));

      expect(sums).toHaveLength(2);
      sums.forEach((sum) => expect(sum).toContain('transaction.resolvedAt'));
    });

    it('reads the sums per id and zeroes ids with no successful deals', async () => {
      const { service } = build([
        {
          bankDetailsId: uuidOf(1),
          total: '1500.500',
          today: '200',
          month: '700.5',
        },
      ]);

      const turnover = await service.turnoverOfBankDetails(
        [uuidOf(1), uuidOf(2)],
        now,
      );

      expect(turnover.get(uuidOf(1))).toEqual({
        total: 1500.5,
        today: 200,
        month: 700.5,
      });
      expect(turnover.get(uuidOf(2))).toEqual({ total: 0, today: 0, month: 0 });
    });

    it('does not query for no ids', async () => {
      const { service, transactions } = build();

      await expect(service.turnoverOfBankDetails([], now)).resolves.toEqual(
        new Map(),
      );
      expect(transactions.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('pageOfBankDetailsByTurnover', () => {
    it('orders in SQL with the id as the tiebreak, in the requested direction', async () => {
      const { service, transactions } = build([], [{ id: uuidOf(2) }]);

      const page = await service.pageOfBankDetailsByTurnover(
        [uuidOf(1), uuidOf(2)],
        'DESC',
        20,
        10,
      );

      expect(page).toEqual([uuidOf(2)]);
      expect(transactions.query).toHaveBeenCalledTimes(1);

      const [sql, params] = transactions.query.mock.calls[0] as unknown as [
        string,
        unknown[],
      ];

      expect(sql).toContain('LEFT JOIN');
      expect(sql).toContain(
        'ORDER BY COALESCE(turnover.total, 0) DESC, candidate.id DESC',
      );
      expect(sql).toContain('LIMIT $3 OFFSET $4');
      expect(params).toEqual([
        [uuidOf(1), uuidOf(2)],
        [TransactionStatus.Success, TransactionStatus.SuccessChanged],
        10,
        20,
      ]);
    });

    it('sorts ascending when asked', async () => {
      const { service, transactions } = build();

      await service.pageOfBankDetailsByTurnover([uuidOf(1)], 'ASC', 0, 20);

      expect(
        (transactions.query.mock.calls[0] as unknown as [string])[0],
      ).toContain('COALESCE(turnover.total, 0) ASC, candidate.id ASC');
    });

    it('does not query for no ids', async () => {
      const { service, transactions } = build();

      await expect(
        service.pageOfBankDetailsByTurnover([], 'ASC', 0, 20),
      ).resolves.toEqual([]);
      expect(transactions.query).not.toHaveBeenCalled();
    });
  });
});
