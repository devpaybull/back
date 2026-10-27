import { formatCrypto } from '../../common/utils/format-crypto';
import { toCrypto } from '../../common/utils/to-crypto';
import { toDecimal } from '../../common/utils/to-decimal';
import { toFiat } from '../../common/utils/to-fiat';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';
import { AnalyticsService } from '../analytics.service';

const zone = (timeZone: string) => ({ getOrThrow: () => timeZone });

describe('AnalyticsService', () => {
  const row = (overrides: Partial<Transaction>): Transaction =>
    ({
      id: uuidOf(1),
      kind: TransactionKind.PayIn,
      status: TransactionStatus.Success,
      traderUserId: uuidOf(1),
      amountFiat: toFiat(0),
      amountCrypto: toDecimal(0),
      traderAmount: toDecimal(0),
      traderCommission: toDecimal(0),
      createdAt: new Date(),
      ...overrides,
    }) as Transaction;

  const rows: Transaction[] = [
    row({
      kind: TransactionKind.PayIn,
      status: TransactionStatus.Success,
      amountFiat: toFiat(26262),
      amountCrypto: toCrypto(270),
      traderAmount: toCrypto(272.207),
      traderCommission: toCrypto(23.137),
    }),
    row({ kind: TransactionKind.PayIn, status: TransactionStatus.Canceled }),
    row({ kind: TransactionKind.PayIn, status: TransactionStatus.Dispute }),
    row({
      kind: TransactionKind.PayOut,
      status: TransactionStatus.Success,
      amountFiat: toFiat(40000),
      amountCrypto: toCrypto(450),
      traderAmount: toCrypto(455.924),
      traderCommission: toCrypto(6.738),
    }),
  ];

  let transactions: { findTraderWindow: jest.Mock };
  let service: AnalyticsService;

  beforeEach(() => {
    transactions = { findTraderWindow: jest.fn(async () => rows) };
    service = new AnalyticsService(transactions as never, zone('UTC') as never);
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
    expect(analytics.summary.cryptoSent).toBe('270.000000');
    expect(analytics.summary.cryptoReceived).toBe('450.000000');
    expect(analytics.summary.fiatReceived).toBe('26262.00');
    expect(analytics.summary.fiatSent).toBe('40000.00');
    expect(analytics.summary.profit).toBe('29.875000');
  });

  it('sums amountCrypto of success and success_changed, not traderAmount', async () => {
    transactions.findTraderWindow.mockResolvedValue([
      row({ amountCrypto: toCrypto(10), traderAmount: toCrypto(10.7) }),
      row({
        status: TransactionStatus.SuccessChanged,
        amountCrypto: toCrypto(5),
        traderAmount: toCrypto(5.3),
      }),
      row({ status: TransactionStatus.Canceled, amountCrypto: toCrypto(99) }),
    ]);

    const analytics = await service.volume(uuidOf(1));

    expect(analytics.summary.cryptoSent).toBe('15.000000');
  });

  describe('volume amounts per day', () => {
    const now = new Date('2026-10-24T12:00:00.000Z');

    const serve = (list: Transaction[], timeZone = 'UTC'): AnalyticsService => {
      const fake = { findTraderWindow: jest.fn(async () => list) };
      return new AnalyticsService(fake as never, zone(timeZone) as never);
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
          amountCrypto: toCrypto(10.5),
        }),
        at('2026-10-24T23:59:59.000Z', {
          kind: TransactionKind.PayIn,
          status: TransactionStatus.SuccessChanged,
          amountCrypto: toCrypto(4.25),
        }),
        at('2026-10-24T05:00:00.000Z', {
          kind: TransactionKind.PayOut,
          amountCrypto: toCrypto(7),
        }),
        at('2026-10-23T05:00:00.000Z', {
          kind: TransactionKind.PayOut,
          amountCrypto: toCrypto(3),
        }),
      ]).volume(uuidOf(1));

      const last = analytics.series[13];
      expect(last.date).toBe('2026-10-24');
      expect(last.payInAmount).toBe('14.750000');
      expect(last.payOutAmount).toBe('7.000000');
      expect(last.payInCount).toBe(2);
      expect(last.payOutCount).toBe(1);
      expect(analytics.series[12].payOutAmount).toBe('3.000000');
      expect(analytics.series[12].payInAmount).toBe('0.000000');
    });

    it('has daily amounts that add up to the summary of the same kind', async () => {
      const analytics = await serve([
        at('2026-10-24T01:00:00.000Z', {
          kind: TransactionKind.PayIn,
          amountCrypto: toCrypto(10.5),
        }),
        at('2026-10-20T01:00:00.000Z', {
          kind: TransactionKind.PayIn,
          status: TransactionStatus.SuccessChanged,
          amountCrypto: toCrypto(4.25),
        }),
        at('2026-10-22T01:00:00.000Z', {
          kind: TransactionKind.PayOut,
          amountCrypto: toCrypto(7.125),
        }),
        at('2026-10-23T01:00:00.000Z', {
          kind: TransactionKind.PayOut,
          status: TransactionStatus.Canceled,
          amountCrypto: toCrypto(50),
        }),
      ]).volume(uuidOf(1));

      const sum = (pick: 'payInAmount' | 'payOutAmount'): string =>
        formatCrypto(
          analytics.series.reduce(
            (total, point) => total.plus(point[pick]),
            toDecimal(0),
          ),
        );
      expect(sum('payInAmount')).toBe(analytics.summary.cryptoSent);
      expect(sum('payOutAmount')).toBe(analytics.summary.cryptoReceived);
    });

    it('counts only success and success_changed', async () => {
      const analytics = await serve([
        at('2026-10-24T01:00:00.000Z', {
          status: TransactionStatus.Canceled,
          amountCrypto: toCrypto(100),
        }),
        at('2026-10-24T01:00:00.000Z', {
          status: TransactionStatus.Dispute,
          amountCrypto: toCrypto(100),
        }),
        at('2026-10-24T01:00:00.000Z', {
          status: TransactionStatus.Success,
          amountCrypto: toCrypto(1),
        }),
      ]).volume(uuidOf(1));

      expect(analytics.series[13].payInAmount).toBe('1.000000');
      expect(analytics.series[13].payInCount).toBe(3);
    });

    it('gives empty days zero amounts', async () => {
      const analytics = await serve([]).volume(uuidOf(1));

      expect(analytics.series).toHaveLength(14);
      for (const point of analytics.series) {
        expect(point.payInAmount).toBe('0.000000');
        expect(point.payOutAmount).toBe('0.000000');
      }
    });

    it('keeps the first and last day of the window and ignores the day before', async () => {
      const analytics = await serve([
        at('2026-10-11T00:00:00.000Z', { amountCrypto: toCrypto(2) }),
        at('2026-10-10T23:59:59.000Z', { amountCrypto: toCrypto(50) }),
      ]).volume(uuidOf(1));

      expect(analytics.series[0].date).toBe('2026-10-11');
      expect(analytics.series[0].payInAmount).toBe('2.000000');
      const total = analytics.series.reduce(
        (sum, point) => sum.plus(point.payInAmount),
        toDecimal(0),
      );
      expect(formatCrypto(total)).toBe('2.000000');
    });

    it('buckets by the calendar day in the business timezone', async () => {
      const analytics = await serve(
        [
          at('2026-10-23T21:30:00.000Z', { amountCrypto: toCrypto(4) }),
          at('2026-10-23T20:30:00.000Z', { amountCrypto: toCrypto(1) }),
        ],
        'Europe/Moscow',
      ).volume(uuidOf(1));

      expect(analytics.series[13].date).toBe('2026-10-24');
      expect(analytics.series[13].payInAmount).toBe('4.000000');
      expect(analytics.series[12].payInAmount).toBe('1.000000');
    });

    it('starts the window at midnight of the first day in the business timezone', async () => {
      const fake = { findTraderWindow: jest.fn(async () => []) };

      await new AnalyticsService(
        fake as never,
        zone('Europe/Moscow') as never,
      ).deals(uuidOf(1));

      expect(fake.findTraderWindow).toHaveBeenCalledWith(
        uuidOf(1),
        new Date('2026-10-10T21:00:00.000Z'),
      );
    });

    it('sums exactly to six decimals without float drift', async () => {
      const analytics = await serve([
        at('2026-10-24T01:00:00.000Z', { amountCrypto: toCrypto(0.1) }),
        at('2026-10-24T02:00:00.000Z', { amountCrypto: toCrypto(0.2) }),
        at('2026-10-24T03:00:00.000Z', { amountCrypto: toCrypto(0.0004) }),
      ]).volume(uuidOf(1));

      expect(analytics.series[13].payInAmount).toBe('0.300400');
    });
  });
});
