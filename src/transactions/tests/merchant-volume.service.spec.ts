import { uuidOf } from '../../common/tests/uuid-of.spec';
import { formatFiat } from '../../common/utils/format-fiat';
import { MerchantVolumeService } from '../services/merchant-volume.service';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';

describe('MerchantVolumeService', () => {
  const from = new Date('2026-10-25T21:00:00Z');
  const to = new Date('2026-10-26T21:00:00Z');

  const build = (rows: Record<string, string>[] = []) => {
    const builder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(async () => rows),
    };
    const transactions = { createQueryBuilder: jest.fn(() => builder) };

    return {
      service: new MerchantVolumeService(transactions as never),
      builder,
      transactions,
    };
  };

  it('asks nothing for no merchants', async () => {
    const { service, transactions } = build();

    expect(await service.volumesByMerchant([], from, to)).toEqual([]);
    expect(transactions.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('sums successful deals resolved in [from, to) in one grouped query', async () => {
    const { service, builder, transactions } = build();

    await service.volumesByMerchant([uuidOf(1), uuidOf(2)], from, to);

    expect(transactions.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(builder.where).toHaveBeenCalledWith(
      'transaction.merchantId IN (:...merchantIds)',
      { merchantIds: [uuidOf(1), uuidOf(2)] },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'transaction.status IN (:...statuses)',
      {
        statuses: [TransactionStatus.Success, TransactionStatus.SuccessChanged],
      },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'transaction.resolvedAt >= :from',
      { from },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'transaction.resolvedAt < :to',
      { to },
    );
    expect(builder.groupBy).toHaveBeenCalledWith('transaction.merchantId');
    expect(builder.addGroupBy).toHaveBeenCalledWith('transaction.method');
    expect(builder.addGroupBy).toHaveBeenCalledWith('transaction.kind');
  });

  it('reads the sum as an exact fiat amount', async () => {
    const { service } = build([
      {
        merchantId: uuidOf(1),
        method: 'sbp',
        kind: TransactionKind.PayIn,
        volume: '1000000000.10',
      },
    ]);

    const [row] = await service.volumesByMerchant([uuidOf(1)], from, to);

    expect(row).toMatchObject({
      merchantId: uuidOf(1),
      method: 'sbp',
      kind: TransactionKind.PayIn,
    });
    expect(formatFiat(row.volume)).toBe('1000000000.10');
  });
});
