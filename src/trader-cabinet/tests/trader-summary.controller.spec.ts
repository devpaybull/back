import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AuthenticatedUser } from '../../common/types/token';
import { toCrypto } from '../../common/utils/to-crypto';
import { Wallet } from '../../transactions/entities/wallet.entity';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';
import { UserStatus } from '../../users/types/user-status.enum';
import { TraderSummaryController } from '../controllers/trader-summary.controller';
import { TrafficBlocker } from '../types/traffic-blocker.enum';

const trader: AuthenticatedUser = {
  id: uuidOf(1),
  login: 'trader',
  role: Role.Trader,
  status: UserStatus.Active,
};

const wallet = {
  mainBalance: toCrypto('1000.5'),
  mainReserved: toCrypto('200'),
  insurancePayInBalance: toCrypto(500),
} as Wallet;

const countsOf = (counts: Partial<Record<TransactionStatus, number>>) => ({
  ...Object.fromEntries(
    Object.values(TransactionStatus).map((status) => [status, 0]),
  ),
  ...counts,
});

const build = (
  setup: {
    settings?: object;
    wallet?: Wallet | null;
    nightStopped?: boolean;
    pool?: number;
    threshold?: number;
  } = {},
) => {
  const settings = {
    findOrDefaults: jest.fn(async () => ({
      tradingEnabled: true,
      payoutTradingEnabled: true,
      ...setup.settings,
    })),
    insurancePayInMinOf: jest.fn(() => toCrypto(500)),
  };
  const wallets = {
    findByUserId: jest.fn(async () =>
      setup.wallet === undefined ? wallet : setup.wallet,
    ),
    getAvailableMain: (row: Wallet) =>
      toCrypto(row.mainBalance.minus(row.mainReserved).toString()),
    hasTradingBalance: (row: Wallet) =>
      row.mainBalance.minus(row.mainReserved).gt(setup.threshold ?? 0),
  };
  const deals = {
    statusCounts: jest.fn(async () =>
      countsOf({
        [TransactionStatus.Active]: 2,
        [TransactionStatus.Dispute]: 1,
        [TransactionStatus.ManualReview]: 3,
        [TransactionStatus.Success]: 50,
      }),
    ),
  };
  const payouts = {
    statusCounts: jest.fn(async () =>
      countsOf({
        [TransactionStatus.Active]: 4,
        [TransactionStatus.Dispute]: 5,
        [TransactionStatus.Checking]: 9,
      }),
    ),
  };
  const payoutActions = {
    poolOf: jest.fn(async () => ({ meta: { total: setup.pool ?? 7 } })),
  };
  const nightStop = {
    isOnNightStop: jest.fn(async () => setup.nightStopped ?? false),
  };
  const tradingSwitch = {
    switch: jest.fn(async (_id: string, enabled: boolean) => ({
      tradingEnabled: enabled,
    })),
  };
  const controller = new TraderSummaryController(
    settings as never,
    wallets as never,
    deals as never,
    payouts as never,
    payoutActions as never,
    nightStop as never,
    tradingSwitch as never,
  );

  return { controller, payoutActions, tradingSwitch, deals, payouts };
};

describe('TraderSummaryController', () => {
  it('answers the balance, the switch, the access and the badges', async () => {
    const { controller, deals, payouts } = build();

    await expect(controller.summary(trader)).resolves.toEqual({
      balance: {
        main: '1000.500000',
        available: '800.500000',
        reserved: '200.000000',
      },
      trading: { payIn: true, payOut: true },
      access: { payouts: true },
      counters: {
        activeDeals: 2,
        appeals: 4,
        activePayouts: 4,
        payoutAppeals: 5,
        availablePayouts: 7,
      },
      blockers: [],
    });
    expect(deals.statusCounts).toHaveBeenCalledWith(trader.id, {});
    expect(payouts.statusCounts).toHaveBeenCalledWith(trader.id, {});
  });

  it('answers zeros for a trader with no wallet and creates nothing', async () => {
    const { controller } = build({
      wallet: null,
      settings: { tradingEnabled: false },
    });

    const summary = await controller.summary(trader);

    expect(summary.balance).toEqual({
      main: '0.000000',
      available: '0.000000',
      reserved: '0.000000',
    });
    expect(summary.blockers).toEqual([
      TrafficBlocker.TradingDisabled,
      TrafficBlocker.InsuranceBelowMinimum,
      TrafficBlocker.BalanceBelowThreshold,
    ]);
  });

  it('without the access hides pay-outs and does not ask for the pool', async () => {
    const { controller, payoutActions } = build({
      settings: { payoutTradingEnabled: false },
    });

    const summary = await controller.summary(trader);

    expect(summary.access.payouts).toBe(false);
    expect(summary.trading).toEqual({ payIn: true, payOut: false });
    expect(summary.counters.availablePayouts).toBe(0);
    expect(payoutActions.poolOf).not.toHaveBeenCalled();
  });

  it('with the switch off shows no pool', async () => {
    const { controller, payoutActions } = build({
      settings: { tradingEnabled: false },
    });

    const summary = await controller.summary(trader);

    expect(summary.trading).toEqual({ payIn: false, payOut: false });
    expect(summary.counters.availablePayouts).toBe(0);
    expect(payoutActions.poolOf).not.toHaveBeenCalled();
  });

  it('names the balance at the threshold, the same comparison as the switch', async () => {
    const { controller } = build({ threshold: 800.5 });

    expect((await controller.summary(trader)).blockers).toEqual([
      TrafficBlocker.BalanceBelowThreshold,
    ]);
  });

  it('names the suspended account and the night stop among the blockers', async () => {
    const { controller } = build({ nightStopped: true });

    const summary = await controller.summary({
      ...trader,
      status: UserStatus.Suspended,
    });

    expect(summary.blockers).toEqual([
      TrafficBlocker.TraderNotActive,
      TrafficBlocker.NightStop,
    ]);
  });

  it('switches for the signed-in trader only, passing the impersonator on', async () => {
    const { controller, tradingSwitch } = build();

    await expect(
      controller.switchTrading(
        { ...trader, impersonatedBy: uuidOf(9) },
        { enabled: true },
      ),
    ).resolves.toEqual({ enabled: true });
    expect(tradingSwitch.switch).toHaveBeenCalledWith(
      trader.id,
      true,
      uuidOf(9),
    );
  });

  it('is for a trader, and the switch is a write', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, TraderSummaryController),
    ).toEqual([Role.Trader]);
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        TraderSummaryController.prototype.switchTrading,
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        TraderSummaryController.prototype.summary,
      ),
    ).toBeUndefined();
  });
});
