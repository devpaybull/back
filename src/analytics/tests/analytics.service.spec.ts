import { uuidOf } from '../../common/tests/uuid-of.spec';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';
import { AnalyticsService } from '../analytics.service';

describe('AnalyticsService', () => {
  const row = (overrides: Partial<Transaction>): Transaction =>
    ({
      id: uuidOf(1),
      kind: TransactionKind.PayIn,
      status: TransactionStatus.Success,
      traderUserId: uuidOf(1),
      amountFiat: 0,
      traderAmount: 0,
      traderCommission: 0,
      createdAt: new Date(),
      ...overrides,
    }) as Transaction;

  const rows: Transaction[] = [
    row({
      kind: TransactionKind.PayIn,
      status: TransactionStatus.Success,
      amountFiat: 26262,
      traderAmount: 272.207,
      traderCommission: 23.137,
    }),
    row({ kind: TransactionKind.PayIn, status: TransactionStatus.Canceled }),
    row({ kind: TransactionKind.PayIn, status: TransactionStatus.Dispute }),
    row({
      kind: TransactionKind.PayOut,
      status: TransactionStatus.Success,
      amountFiat: 40000,
      traderAmount: 455.924,
      traderCommission: 6.738,
    }),
  ];

  let transactions: { findTraderWindow: jest.Mock };
  let service: AnalyticsService;

  beforeEach(() => {
    transactions = { findTraderWindow: jest.fn(async () => rows) };
    service = new AnalyticsService(transactions as never);
  });

  it('returns a 14-point series', async () => {
    const analytics = await service.deals(uuidOf(1));
    expect(analytics.series).toHaveLength(14);
  });

  it('counts deal outcomes by working definitions', async () => {
    const analytics = await service.deals(uuidOf(1));

    expect(analytics.total).toBe(4);
    expect(analytics.success).toBe(2);
    expect(analytics.fail).toBe(1);
    expect(analytics.dispute).toBe(1);
  });

  it('computes pay-in conversion over success and fail only', async () => {
    const analytics = await service.payIn(uuidOf(1));

    expect(analytics.averageConversionPercent).toBe(50);
    expect(analytics.disputePercent).toBe(33.33);
  });

  it('sums volume over successful deals per direction', async () => {
    const analytics = await service.volume(uuidOf(1));

    expect(analytics.payInCount).toBe(3);
    expect(analytics.payOutCount).toBe(1);
    expect(analytics.summary.cryptoSent).toBe(272.207);
    expect(analytics.summary.cryptoReceived).toBe(455.924);
    expect(analytics.summary.fiatReceived).toBe(26262);
    expect(analytics.summary.fiatSent).toBe(40000);
    expect(analytics.summary.profit).toBe(29.875);
  });
});
