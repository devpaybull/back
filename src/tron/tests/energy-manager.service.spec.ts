import { toCrypto } from '../../common/utils/to-crypto';
import { toRate } from '../../common/utils/to-rate';
import { EnergyManager } from '../services/energy-manager.service';
import { AccountResources } from '../types/account-resources';
import { TransferCost } from '../types/transfer-cost';

const DEPOSIT = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';
const HOT = 'TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC';
const ENERGY = 'TDvSsdrNM5eeXNL3czpa6AxLDHZA9nwe9K';

const resources = (
  overrides: Partial<AccountResources> = {},
): AccountResources => ({
  energyLimit: 0,
  energyUsed: 0,
  freeBandwidthLimit: 600,
  freeBandwidthUsed: 0,
  bandwidthLimit: 0,
  bandwidthUsed: 0,
  totalEnergyLimit: 90_000_000_000,
  totalEnergyWeight: 18_000_000_000,
  ...overrides,
});

const COST: TransferCost = {
  energy: 65_000,
  bandwidth: 350,
  burnSun: '27650000',
};

const build = (
  options: {
    deposit?: Partial<AccountResources>;
    energyWallet?: Partial<AccountResources>;
    delegatableSun?: string;
    trxBalanceSun?: string;
    burnAllowed?: boolean;
    maxBurn?: string;
  } = {},
) => {
  const node = {
    estimateUsdtTransferEnergy: jest.fn(async () => 65_000),
    getChainParameters: jest.fn(async () => ({
      energyFeeSun: 420,
      bandwidthFeeSun: 1000,
      createAccountFeeSun: 1_000_000,
    })),
    getAccountResources: jest.fn(async (address: string) =>
      address === ENERGY
        ? resources(options.energyWallet)
        : resources(options.deposit),
    ),
    getDelegatableEnergySun: jest.fn(async () => options.delegatableSun ?? '0'),
    getTrxBalanceSun: jest.fn(async () => options.trxBalanceSun ?? '0'),
  };
  const values: Record<string, unknown> = {
    SWEEP_BURN_WHEN_NO_ENERGY: options.burnAllowed ?? true,
    TRON_MAX_TRX_BURN_PER_TX: options.maxBurn ?? '30',
  };
  const config = {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => values[key]),
  };
  const keyring = { energyAddress: jest.fn(async () => ENERGY) };
  const rate = { getUsdtPerTrx: jest.fn(async () => toRate('0.341')) };
  const manager = new EnergyManager(
    config as never,
    node as never,
    keyring as never,
    rate,
  );

  return { manager, node, rate };
};

describe('EnergyManager', () => {
  it('prices a USDT transfer as its energy at the energy fee plus 350 bytes of bandwidth', async () => {
    const { manager, node } = build();

    await expect(
      manager.estimateUsdtTransfer(HOT, DEPOSIT, toCrypto('12.5')),
    ).resolves.toEqual({ energy: 65_000, bandwidth: 350, burnSun: '27650000' });
    expect(node.estimateUsdtTransferEnergy).toHaveBeenCalledWith(
      HOT,
      DEPOSIT,
      '12500000',
    );
  });

  it('quotes the fee in TRX and in USDT through the rate source', async () => {
    const { manager } = build();

    const quote = await manager.quoteUsdtTransferFee(HOT, DEPOSIT, toCrypto(1));

    expect(quote.trx.toFixed(6)).toBe('27.650000');
    expect(quote.usdt.toFixed(6)).toBe('9.428650');
  });

  describe('planForSweep', () => {
    it('is ready when the address has the energy and the free bandwidth', async () => {
      const { manager } = build({ deposit: { energyLimit: 70_000 } });

      await expect(manager.planForSweep(DEPOSIT, COST)).resolves.toEqual({
        action: 'ready',
      });
    });

    it('delegates the missing energy, rounded up to whole TRX of stake', async () => {
      const { manager } = build({
        deposit: { energyLimit: 1, energyUsed: 0 },
        delegatableSun: '20000000000',
      });

      await expect(manager.planForSweep(DEPOSIT, COST)).resolves.toEqual({
        action: 'delegate',
        balanceSun: '13000000000',
      });
    });

    it('delegates at least one TRX', async () => {
      const { manager } = build({
        deposit: { energyLimit: 64_999 },
        delegatableSun: '20000000000',
      });

      await expect(manager.planForSweep(DEPOSIT, COST)).resolves.toEqual({
        action: 'delegate',
        balanceSun: '1000000',
      });
    });

    it('waits when there is too little to delegate and burning is off', async () => {
      const { manager } = build({
        delegatableSun: '1000000',
        burnAllowed: false,
      });

      await expect(manager.planForSweep(DEPOSIT, COST)).resolves.toEqual({
        action: 'wait',
      });
    });

    it('waits when the network reports no energy weight to price a delegation', async () => {
      const { manager } = build({
        energyWallet: { totalEnergyLimit: 0, totalEnergyWeight: 0 },
        delegatableSun: '99999999999',
        burnAllowed: false,
      });

      await expect(manager.planForSweep(DEPOSIT, COST)).resolves.toEqual({
        action: 'wait',
      });
    });

    it('tops up only the TRX the address is missing to burn', async () => {
      const { manager } = build({ trxBalanceSun: '10000000' });

      await expect(manager.planForSweep(DEPOSIT, COST)).resolves.toEqual({
        action: 'burn',
        burnSun: '17300000',
      });
    });

    it('burns only for the energy shortfall, not for bandwidth the address has for free', async () => {
      const { manager } = build({
        trxBalanceSun: '0',
        deposit: { energyLimit: 30_000 },
      });

      await expect(manager.planForSweep(DEPOSIT, COST)).resolves.toEqual({
        action: 'burn',
        burnSun: String((65_000 - 30_000) * 420),
      });
    });

    it('is ready to burn when the address already holds the TRX', async () => {
      const { manager } = build({ trxBalanceSun: '27300000' });

      await expect(manager.planForSweep(DEPOSIT, COST)).resolves.toEqual({
        action: 'ready',
      });
    });

    it('waits rather than burn above TRON_MAX_TRX_BURN_PER_TX', async () => {
      const { manager } = build({ maxBurn: '20' });

      await expect(manager.planForSweep(DEPOSIT, COST)).resolves.toEqual({
        action: 'wait',
      });
    });

    it('burns only for the bandwidth when the energy is there but the free bandwidth is spent', async () => {
      const { manager } = build({
        deposit: { energyLimit: 70_000, freeBandwidthUsed: 500 },
      });

      await expect(manager.planForSweep(DEPOSIT, COST)).resolves.toEqual({
        action: 'burn',
        burnSun: '350000',
      });
    });

    it('funds the bandwidth first, then delegates, when both are short', async () => {
      const short = build({
        deposit: { freeBandwidthUsed: 500 },
        delegatableSun: '20000000000',
      });
      const funded = build({
        deposit: { freeBandwidthUsed: 500 },
        delegatableSun: '20000000000',
        trxBalanceSun: '350000',
      });

      await expect(short.manager.planForSweep(DEPOSIT, COST)).resolves.toEqual({
        action: 'burn',
        burnSun: '350000',
      });
      await expect(funded.manager.planForSweep(DEPOSIT, COST)).resolves.toEqual(
        {
          action: 'delegate',
          balanceSun: '13000000000',
        },
      );
    });
  });

  describe('canPayFrom', () => {
    it('pays with its own energy', async () => {
      const { manager } = build({ deposit: { energyLimit: 65_000 } });

      await expect(manager.canPayFrom(HOT, COST)).resolves.toBe(true);
    });

    it('pays by burning only with enough TRX', async () => {
      await expect(
        build({ trxBalanceSun: '27650000' }).manager.canPayFrom(HOT, COST),
      ).resolves.toBe(true);
      await expect(
        build({ trxBalanceSun: '27649999' }).manager.canPayFrom(HOT, COST),
      ).resolves.toBe(false);
    });
  });

  it('reads the burn ceiling in sun', () => {
    expect(build({ maxBurn: '12.5' }).manager.maxBurnSun()).toBe(12_500_000n);
  });
});
