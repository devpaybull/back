import { Injectable } from '@nestjs/common';
import { TraderSettings } from '../../trader-settings/entities/trader-settings.entity';
import { TraderSettingsService } from '../../trader-settings/trader-settings.service';
import { WalletService } from './wallet.service';

@Injectable()
export class TradingSwitchService {
  constructor(
    private readonly settings: TraderSettingsService,
    private readonly wallets: WalletService,
  ) {}

  switch(
    traderUserId: string,
    enabled: boolean,
    impersonatorUserId: string | null,
  ): Promise<TraderSettings> {
    return this.settings.switchTrading(
      traderUserId,
      enabled,
      impersonatorUserId,
      (manager, settings) =>
        this.wallets.assertMayEnableTradingWithin(
          manager,
          traderUserId,
          settings,
        ),
    );
  }
}
