import { uuidOf } from '../../common/tests/uuid-of.spec';
import { TraderSettings } from '../../trader-settings/entities/trader-settings.entity';
import { TraderSettingsService } from '../../trader-settings/trader-settings.service';
import { Wallet } from '../entities/wallet.entity';
import { WalletService } from '../services/wallet.service';

describe('WalletService.hasMinInsurancePayIn', () => {
  const GLOBAL_MIN = 500;

  const build = (
    balance: number,
    personal: number | null,
    hasSettingsRow = true,
  ) => {
    const wallets = {
      findOne: jest.fn(
        async () => ({ insurancePayInBalance: balance }) as Wallet,
      ),
    };
    const settingsRepository = {
      findOne: jest.fn(async () =>
        !hasSettingsRow
          ? null
          : personal === null
            ? ({ insurancePayInMin: null } as TraderSettings)
            : ({ insurancePayInMin: personal } as TraderSettings),
      ),
    };
    const config = { get: jest.fn(() => GLOBAL_MIN) };
    const traderSettings = new TraderSettingsService(
      settingsRepository as never,
      {} as never,
      {} as never,
      config as never,
    );

    return new WalletService(
      wallets as never,
      {} as never,
      config as never,
      traderSettings,
    );
  };

  it('refuses a balance below a higher personal minimum', async () => {
    await expect(
      build(600, 1000).hasMinInsurancePayIn(uuidOf(1)),
    ).resolves.toBe(false);
  });

  it('accepts a balance above a lower personal minimum', async () => {
    await expect(build(200, 100).hasMinInsurancePayIn(uuidOf(1))).resolves.toBe(
      true,
    );
  });

  it('falls back to the global minimum without a personal one', async () => {
    await expect(
      build(400, null).hasMinInsurancePayIn(uuidOf(1)),
    ).resolves.toBe(false);
    await expect(
      build(500, null).hasMinInsurancePayIn(uuidOf(1)),
    ).resolves.toBe(true);
  });

  it('uses the global minimum when the account has no settings row', async () => {
    await expect(
      build(400, null, false).hasMinInsurancePayIn(uuidOf(1)),
    ).resolves.toBe(false);
    await expect(
      build(500, null, false).hasMinInsurancePayIn(uuidOf(1)),
    ).resolves.toBe(true);
  });

  it('accepts a zero balance against a personal minimum of zero', async () => {
    await expect(build(0, 0).hasMinInsurancePayIn(uuidOf(1))).resolves.toBe(
      true,
    );
  });
});
