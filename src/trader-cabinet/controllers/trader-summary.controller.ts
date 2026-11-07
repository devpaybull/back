import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WriteAccess } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { AuthenticatedUser } from '../../common/types/token';
import { formatCrypto } from '../../common/utils/format-crypto';
import { toCrypto } from '../../common/utils/to-crypto';
import { TraderSettings } from '../../trader-settings/entities/trader-settings.entity';
import { TraderSettingsService } from '../../trader-settings/trader-settings.service';
import { Wallet } from '../../transactions/entities/wallet.entity';
import { NightStopService } from '../../transactions/services/night-stop.service';
import { TraderDealsService } from '../../transactions/services/trader-deals.service';
import { TraderPayoutActionsService } from '../../transactions/services/trader-payout-actions.service';
import { TraderPayoutsService } from '../../transactions/services/trader-payouts.service';
import { TradingSwitchService } from '../../transactions/services/trading-switch.service';
import { WalletService } from '../../transactions/services/wallet.service';
import { TransactionSortField } from '../../transactions/types/transaction-sort-field.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';
import { UserStatus } from '../../users/types/user-status.enum';
import { SwitchTradingDto } from '../dto/switch-trading.dto';
import { TraderSummaryDto } from '../dto/trader-summary.dto';
import { TradingStateDto } from '../dto/trading-state.dto';
import { TrafficBlocker } from '../types/traffic-blocker.enum';

@ApiTags('Trader · Summary')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Trader)
@Controller('trader')
export class TraderSummaryController {
  constructor(
    private readonly settings: TraderSettingsService,
    private readonly wallets: WalletService,
    private readonly deals: TraderDealsService,
    private readonly payouts: TraderPayoutsService,
    private readonly payoutActions: TraderPayoutActionsService,
    private readonly nightStop: NightStopService,
    private readonly tradingSwitch: TradingSwitchService,
  ) {}

  @Get('summary')
  @ApiOperation({
    summary: 'The header and the sidebar: balance, trading, badges',
    description:
      'Polled by the cabinet. `blockers` names why pay-ins are not offered now.',
  })
  @ApiEnvelopeResponse(TraderSummaryDto)
  async summary(
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<TraderSummaryDto> {
    const now = new Date();
    const [settings, wallet, deals, payouts, nightStopped] = await Promise.all([
      this.settings.findOrDefaults(trader.id),
      this.wallets.findByUserId(trader.id),
      this.deals.statusCounts(trader.id, {}),
      this.payouts.statusCounts(trader.id, {}),
      this.nightStop.isOnNightStop(trader.id, now),
    ]);
    const main = wallet?.mainBalance ?? toCrypto(0);
    const reserved = wallet?.mainReserved ?? toCrypto(0);
    const available = wallet ? this.wallets.getAvailableMain(wallet) : main;

    return {
      balance: {
        main: formatCrypto(main),
        available: formatCrypto(available),
        reserved: formatCrypto(reserved),
      },
      trading: {
        payIn: settings.tradingEnabled,
        payOut: settings.tradingEnabled && settings.payoutTradingEnabled,
      },
      access: { payouts: settings.payoutTradingEnabled },
      counters: {
        activeDeals: deals[TransactionStatus.Active],
        appeals:
          deals[TransactionStatus.Dispute] +
          deals[TransactionStatus.ManualReview],
        activePayouts: payouts[TransactionStatus.Active],
        payoutAppeals:
          payouts[TransactionStatus.Dispute] +
          payouts[TransactionStatus.ManualReview],
        availablePayouts: await this.availablePayouts(trader.id, settings, now),
      },
      blockers: this.blockersOf(trader, settings, wallet, nightStopped),
    };
  }

  @Post('trading')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @ApiOperation({
    summary: 'The «Торговля» switch: whether the trader gets deals at all',
    description:
      'Current deals live on. Switching on is a 409 INSURANCE_BELOW_MINIMUM or BALANCE_BELOW_THRESHOLD; repeating the current value is a 200 with no audit row.',
  })
  @ApiEnvelopeResponse(TradingStateDto)
  async switchTrading(
    @CurrentUser() trader: AuthenticatedUser,
    @Body() dto: SwitchTradingDto,
  ): Promise<TradingStateDto> {
    const settings = await this.tradingSwitch.switch(
      trader.id,
      dto.enabled,
      trader.impersonatedBy ?? null,
    );

    return { enabled: settings.tradingEnabled };
  }

  private async availablePayouts(
    traderUserId: string,
    settings: TraderSettings,
    now: Date,
  ): Promise<number> {
    if (!settings.payoutTradingEnabled || !settings.tradingEnabled) return 0;

    const pool = await this.payoutActions.poolOf(
      traderUserId,
      settings,
      {
        page: 1,
        limit: 1,
        sortBy: TransactionSortField.CreatedAt,
        sortOrder: SortOrder.Desc,
      },
      now,
    );

    return pool.meta.total;
  }

  private blockersOf(
    trader: AuthenticatedUser,
    settings: TraderSettings,
    wallet: Wallet | null,
    nightStopped: boolean,
  ): TrafficBlocker[] {
    const insurance = wallet?.insurancePayInBalance ?? toCrypto(0);
    const checks: [boolean, TrafficBlocker][] = [
      [trader.status !== UserStatus.Active, TrafficBlocker.TraderNotActive],
      [!settings.tradingEnabled, TrafficBlocker.TradingDisabled],
      [nightStopped, TrafficBlocker.NightStop],
      [
        insurance.lt(this.settings.insurancePayInMinOf(settings)),
        TrafficBlocker.InsuranceBelowMinimum,
      ],
      [
        !wallet || !this.wallets.hasTradingBalance(wallet),
        TrafficBlocker.BalanceBelowThreshold,
      ],
    ];

    return checks.filter(([applies]) => applies).map(([, blocker]) => blocker);
  }
}
