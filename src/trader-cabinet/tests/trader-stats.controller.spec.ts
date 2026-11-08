import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { DayPeriod } from '../../common/enums/day-period.enum';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AuthenticatedUser } from '../../common/types/token';
import { toCrypto } from '../../common/utils/to-crypto';
import { toFiat } from '../../common/utils/to-fiat';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { UserStatus } from '../../users/types/user-status.enum';
import { TraderStatsController } from '../controllers/trader-stats.controller';

const trader: AuthenticatedUser = {
  id: uuidOf(1),
  login: 'trader',
  role: Role.Trader,
  status: UserStatus.Active,
};

const empty = {
  issued: 0,
  skipped: 0,
  paid: 0,
  canceled: 0,
  successCount: 0,
  turnover: toFiat(0),
  volumeCrypto: toCrypto(0),
  income: toCrypto(0),
  depositSeconds: null,
  payoutSeconds: null,
  disputeSeconds: null,
};

const build = (summary = empty) => {
  const stats = {
    summary: jest.fn(async () => summary),
    daily: jest.fn(async () => [
      {
        day: '2026-11-08',
        income: toCrypto('1.5'),
        turnover: toFiat('1000'),
        created: 4,
        paid: 1,
        canceled: 2,
        disputed: 1,
      },
      {
        day: '2026-11-07',
        income: toCrypto(0),
        turnover: toFiat(0),
        created: 0,
        paid: 0,
        canceled: 0,
        disputed: 0,
      },
    ]),
    buckets: jest.fn(async () => [
      {
        label: '1-999',
        count: 2,
        volumeCrypto: toCrypto('10.5'),
        volumeFiat: toFiat('950'),
      },
    ]),
  };
  const controller = new TraderStatsController(
    stats as never,
    { getOrThrow: () => 'Europe/Moscow' } as never,
  );

  return { controller, stats };
};

describe('TraderStatsController', () => {
  it('is the trader’s alone', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, TraderStatsController),
    ).toEqual([Role.Trader]);
  });

  it('computes each card exactly from the sums', async () => {
    const { controller, stats } = build({
      issued: 475,
      skipped: 25,
      paid: 475,
      canceled: 438,
      successCount: 3,
      turnover: toFiat('4650.15'),
      volumeCrypto: toCrypto('52.3'),
      income: toCrypto('3.1'),
      depositSeconds: 314,
      payoutSeconds: 2535,
      disputeSeconds: 1394,
    });

    const summary = await controller.summary(trader, {
      period: DayPeriod.AllTime,
      direction: TransactionKind.PayIn,
      method: 'sbp',
      bankDetailsId: uuidOf(9),
    });

    expect(summary).toEqual({
      issue: { issued: 475, skipped: 25, percent: 95 },
      payment: { paid: 475, canceled: 438, percent: 52.03 },
      turnover: { amount: '4650.15', count: 3, averageCheck: '1550.05' },
      income: { amount: '3.100000', averageRate: '88.913002' },
      response: {
        depositSeconds: 314,
        payoutSeconds: 2535,
        disputeSeconds: 1394,
      },
    });
    expect(stats.summary).toHaveBeenCalledWith(
      trader.id,
      expect.objectContaining({ from: null }),
      { kind: TransactionKind.PayIn, method: 'sbp', bankDetailsId: uuidOf(9) },
    );
  });

  it('answers nulls, not zeros or a division by zero, for an empty period', async () => {
    const { controller } = build();

    const summary = await controller.summary(trader, {});

    expect(summary.issue.percent).toBeNull();
    expect(summary.payment.percent).toBeNull();
    expect(summary.turnover).toEqual({
      amount: '0.00',
      count: 0,
      averageCheck: null,
    });
    expect(summary.income).toEqual({ amount: '0.000000', averageRate: null });
  });

  it('defaults to today in the business zone', async () => {
    const { controller, stats } = build();

    await controller.summary(trader, {});

    const [, range] = stats.summary.mock.calls[0] as unknown as [
      string,
      { from: Date; to: Date },
    ];
    expect(range.to.getTime() - range.from.getTime()).toBe(86_400_000);
    expect(range.from.getUTCHours()).toBe(21);
  });

  it('turns each day into percents, null where nothing happened', async () => {
    const { controller } = build();

    expect(await controller.daily(trader, {})).toEqual([
      {
        date: '2026-11-08',
        income: '1.500000',
        turnover: '1000.00',
        conversionPercent: 33.33,
        disputePercent: 25,
      },
      {
        date: '2026-11-07',
        income: '0.000000',
        turnover: '0.00',
        conversionPercent: null,
        disputePercent: null,
      },
    ]);
  });

  it('renders the buckets as strings of their scale', async () => {
    const { controller } = build();

    expect(await controller.buckets(trader, {})).toEqual([
      {
        range: '1-999',
        count: 2,
        volumeCrypto: '10.500000',
        volumeFiat: '950.00',
      },
    ]);
  });
});
