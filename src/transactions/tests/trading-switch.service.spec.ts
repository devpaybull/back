import { uuidOf } from '../../common/tests/uuid-of.spec';
import { TraderSettings } from '../../trader-settings/entities/trader-settings.entity';
import { TradingSwitchService } from '../services/trading-switch.service';

describe('TradingSwitchService', () => {
  const settingsRow = { tradingEnabled: true } as TraderSettings;

  it('checks the trader’s own wallet inside the settings transaction', async () => {
    const manager = {};
    const settings = {
      switchTrading: jest.fn(
        async (
          _user: string,
          _enabled: boolean,
          _impersonator: string | null,
          check: (m: unknown, row: TraderSettings) => Promise<void>,
        ) => {
          await check(manager, settingsRow);

          return settingsRow;
        },
      ),
    };
    const wallets = {
      assertMayEnableTradingWithin: jest.fn(async () => undefined),
    };
    const service = new TradingSwitchService(
      settings as never,
      wallets as never,
    );

    await expect(service.switch(uuidOf(1), true, uuidOf(9))).resolves.toBe(
      settingsRow,
    );
    expect(settings.switchTrading).toHaveBeenCalledWith(
      uuidOf(1),
      true,
      uuidOf(9),
      expect.any(Function),
    );
    expect(wallets.assertMayEnableTradingWithin).toHaveBeenCalledWith(
      manager,
      uuidOf(1),
      settingsRow,
    );
  });
});
