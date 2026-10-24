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
      amountCrypto: 0,
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
      amountCrypto: 270,
      traderAmount: 272.207,
      traderCommission: 23.137,
    }),
    row({ kind: TransactionKind.PayIn, status: TransactionStatus.Canceled }),
    row({ kind: TransactionKind.PayIn, status: TransactionStatus.Dispute }),
    row({
      kind: TransactionKind.PayOut,
      status: TransactionStatus.Success,
      amountFiat: 40000,
      amountCrypto: 450,
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
    expect(analytics.summary.cryptoSent).toBe(270);
    expect(analytics.summary.cryptoReceived).toBe(450);
    expect(analytics.summary.fiatReceived).toBe(26262);
    expect(analytics.summary.fiatSent).toBe(40000);
    expect(analytics.summary.profit).toBe(29.875);
  });

  it('sums amountCrypto of success and success_changed, not traderAmount', async () => {
    transactions.findTraderWindow.mockResolvedValue([
      row({ amountCrypto: 10, traderAmount: 10.7 }),
      row({
        status: TransactionStatus.SuccessChanged,
        amountCrypto: 5,
        traderAmount: 5.3,
      }),
      row({ status: TransactionStatus.Canceled, amountCrypto: 99 }),
    ]);

    const analytics = await service.volume(uuidOf(1));

    expect(analytics.summary.cryptoSent).toBe(15);
  });

  describe('volume amounts per day', () => {
    const now = new Date('2026-10-24T12:00:00.000Z');

    const serve = (list: Transaction[]): AnalyticsService => {
      const fake = { findTraderWindow: jest.fn(async () => list) };
      return new AnalyticsService(fake as never);
    };

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(now);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    const at = (iso: string, overrides: Partial<Transaction>): Transaction =>
      row({ createdAt: new Date(iso), ...overrides });

    it('sums amountCrypto per day separately for pay-in and pay-out', async () => {
      const analytics = await serve([
        at('2026-10-24T01:00:00.000Z', {
          kind: TransactionKind.PayIn,
          amountCrypto: 10.5,
        }),
        at('2026-10-24T23:59:59.000Z', {
          kind: TransactionKind.PayIn,
          status: TransactionStatus.SuccessChanged,
          amountCrypto: 4.25,
        }),
        at('2026-10-24T05:00:00.000Z', {
          kind: TransactionKind.PayOut,
          amountCrypto: 7,
        }),
        at('2026-10-23T05:00:00.000Z', {
          kind: TransactionKind.PayOut,
          amountCrypto: 3,
        }),
      ]).volume(uuidOf(1));

      const last = analytics.series[13];
      expect(last.date).toBe('2026-10-24');
      expect(last.payInAmount).toBe(14.75);
      expect(last.payOutAmount).toBe(7);
      expect(last.payInCount).toBe(2);
      expect(last.payOutCount).toBe(1);
      expect(analytics.series[12].payOutAmount).toBe(3);
      expect(analytics.series[12].payInAmount).toBe(0);
    });

    it('has daily amounts that add up to the summary of the same kind', async () => {
      const analytics = await serve([
        at('2026-10-24T01:00:00.000Z', {
          kind: TransactionKind.PayIn,
          amountCrypto: 10.5,
        }),
        at('2026-10-20T01:00:00.000Z', {
          kind: TransactionKind.PayIn,
          status: TransactionStatus.SuccessChanged,
          amountCrypto: 4.25,
        }),
        at('2026-10-22T01:00:00.000Z', {
          kind: TransactionKind.PayOut,
          amountCrypto: 7.125,
        }),
        at('2026-10-23T01:00:00.000Z', {
          kind: TransactionKind.PayOut,
          status: TransactionStatus.Canceled,
          amountCrypto: 50,
        }),
      ]).volume(uuidOf(1));

      const sum = (pick: 'payInAmount' | 'payOutAmount'): number =>
        analytics.series.reduce((total, point) => total + point[pick], 0);
      expect(sum('payInAmount')).toBeCloseTo(analytics.summary.cryptoSent, 3);
      expect(sum('payOutAmount')).toBeCloseTo(
        analytics.summary.cryptoReceived,
        3,
      );
    });

    it('counts only success and success_changed', async () => {
      const analytics = await serve([
        at('2026-10-24T01:00:00.000Z', {
          status: TransactionStatus.Canceled,
          amountCrypto: 100,
        }),
        at('2026-10-24T01:00:00.000Z', {
          status: TransactionStatus.Dispute,
          amountCrypto: 100,
        }),
        at('2026-10-24T01:00:00.000Z', {
          status: TransactionStatus.Success,
          amountCrypto: 1,
        }),
      ]).volume(uuidOf(1));

      expect(analytics.series[13].payInAmount).toBe(1);
      expect(analytics.series[13].payInCount).toBe(3);
    });

    it('gives empty days zero amounts', async () => {
      const analytics = await serve([]).volume(uuidOf(1));

      expect(analytics.series).toHaveLength(14);
      for (const point of analytics.series) {
        expect(point.payInAmount).toBe(0);
        expect(point.payOutAmount).toBe(0);
      }
    });

    it('keeps the first and last day of the window and ignores the day before', async () => {
      const analytics = await serve([
        at('2026-10-11T00:00:00.000Z', { amountCrypto: 2 }),
        at('2026-10-10T23:59:59.000Z', { amountCrypto: 50 }),
      ]).volume(uuidOf(1));

      expect(analytics.series[0].date).toBe('2026-10-11');
      expect(analytics.series[0].payInAmount).toBe(2);
      const total = analytics.series.reduce(
        (sum, point) => sum + point.payInAmount,
        0,
      );
      expect(total).toBe(2);
    });

    it('rounds sums to three decimals without float drift', async () => {
      const analytics = await serve([
        at('2026-10-24T01:00:00.000Z', { amountCrypto: 0.1 }),
        at('2026-10-24T02:00:00.000Z', { amountCrypto: 0.2 }),
        at('2026-10-24T03:00:00.000Z', { amountCrypto: 0.0004 }),
      ]).volume(uuidOf(1));

      expect(analytics.series[13].payInAmount).toBe(0.3);
    });
  });
});
