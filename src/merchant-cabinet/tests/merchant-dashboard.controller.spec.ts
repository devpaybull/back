import { DayPeriod } from '../../common/enums/day-period.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toCrypto } from '../../common/utils/to-crypto';
import { toRate } from '../../common/utils/to-rate';
import { MerchantDashboardController } from '../controllers/merchant-dashboard.controller';

const MERCHANT = uuidOf(30);

describe('MerchantDashboardController', () => {
  const build = ({
    isocode = 'RUB',
    count = 52,
    rateFails = false,
  }: { isocode?: string; count?: number; rateFails?: boolean } = {}) => {
    const stats = {
      dashboardTotals: jest.fn(async () => ({
        turnover: toCrypto('1000.5'),
        creditedPayIn: toCrypto(900),
        payInCommission: toCrypto(50),
        successfulPayInCount: count,
        successfulPayInAmount: count ? toCrypto(5200) : toCrypto(0),
      })),
      turnoverSeries: jest.fn(async () => [
        { day: '2026-08-19', amount: toCrypto('4521.52') },
      ]),
    };
    const balances = {
      statesByMerchant: jest.fn(
        async () =>
          new Map([
            [
              MERCHANT,
              {
                balance: toCrypto('120500.5'),
                escrow: toCrypto(0),
                withdrawalReserved: toCrypto('500.5'),
              },
            ],
          ]),
      ),
    };
    const withdrawals = {
      merchantWithdrawalTotals: jest.fn(async () => ({
        inProgressAmount: toCrypto('500.5'),
        inProgressCount: 1,
        withdrawn: toCrypto(300),
      })),
    };
    const settings = {
      settingsOf: jest.fn(async () => ({ defaultCurrencyId: 1 })),
    };
    const currencies = {
      currenciesByMerchant: jest.fn(
        async () =>
          new Map([
            [
              MERCHANT,
              [
                {
                  currencyId: 1,
                  payInMarkupPercent: 1.5,
                  currency: { isocode },
                },
              ],
            ],
          ]),
      ),
    };
    const rates = {
      merchantSourceRate: jest.fn(async () => {
        if (rateFails) throw new Error('Rapira is down');

        return toRate('88.24');
      }),
    };
    const config = { getOrThrow: jest.fn(() => 'Europe/Moscow') };

    return {
      stats,
      rates,
      withdrawals,
      controller: new MerchantDashboardController(
        stats as never,
        balances as never,
        withdrawals as never,
        settings as never,
        currencies as never,
        rates as never,
        config as never,
      ),
    };
  };

  it('composes the dashboard for all time by default', async () => {
    const { controller, stats, rates } = build();

    const dashboard = await controller.read(MERCHANT, {});

    expect(stats.dashboardTotals).toHaveBeenCalledWith(
      MERCHANT,
      null,
      expect.any(Date),
    );
    expect(rates.merchantSourceRate).toHaveBeenCalledWith(1.5);
    expect(dashboard).toMatchObject({
      balance: {
        available: '120500.500000',
        escrow: '0.000000',
        rate: { currency: 'RUB', value: '88.240000' },
      },
      withdrawals: { inProgressAmount: '500.500000', inProgressCount: 1 },
      results: {
        turnover: '1000.500000',
        creditedPayIn: '900.000000',
        payInCommission: '50.000000',
        withdrawn: '300.000000',
      },
      payIns: {
        successfulCount: 52,
        successfulAmount: '5200.000000',
        averageAmount: '100.000000',
      },
    });
  });

  it('passes a preset period on to both reads', async () => {
    const { controller, stats, withdrawals } = build();

    await controller.read(MERCHANT, { period: DayPeriod.Today });

    const [, from] = stats.dashboardTotals.mock.calls[0] as unknown[];
    expect(from).toBeInstanceOf(Date);
    expect(withdrawals.merchantWithdrawalTotals).toHaveBeenCalledWith(
      MERCHANT,
      from,
      expect.any(Date),
    );
  });

  it('answers an average of zero with no successful pay-in', async () => {
    const { controller } = build({ count: 0 });

    expect((await controller.read(MERCHANT, {})).payIns.averageAmount).toBe(
      '0.000000',
    );
  });

  it('shows no rate for a default currency Rapira does not quote, and asks nothing', async () => {
    const { controller, rates } = build({ isocode: 'KZT' });

    expect((await controller.read(MERCHANT, {})).balance.rate).toBeNull();
    expect(rates.merchantSourceRate).not.toHaveBeenCalled();
  });

  it('shows no rate rather than failing when Rapira is down', async () => {
    const { controller } = build({ rateFails: true });

    expect((await controller.read(MERCHANT, {})).balance.rate).toBeNull();
  });

  it('answers the 30-day series as strings', async () => {
    const { controller, stats } = build();

    expect(await controller.turnoverSeries(MERCHANT)).toEqual([
      { day: '2026-08-19', amount: '4521.520000' },
    ]);
    expect(stats.turnoverSeries).toHaveBeenCalledWith(
      MERCHANT,
      30,
      'Europe/Moscow',
    );
  });
});
