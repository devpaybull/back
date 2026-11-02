import { Controller, Get, Logger, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountTransactionsService } from '../../account-transactions/services/account-transactions.service';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DayPeriod } from '../../common/enums/day-period.enum';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { dayPeriodRange } from '../../common/utils/day-period-range';
import { formatCrypto } from '../../common/utils/format-crypto';
import { formatRate } from '../../common/utils/format-rate';
import { roundCrypto } from '../../common/utils/round-crypto';
import { toCrypto } from '../../common/utils/to-crypto';
import { MerchantCurrenciesService } from '../../merchants/services/merchant-currencies.service';
import { MerchantSettingsService } from '../../merchants/services/merchant-settings.service';
import { MerchantBalanceService } from '../../transactions/services/merchant-balance.service';
import { MerchantStatsService } from '../../transactions/services/merchant-stats.service';
import { RateService } from '../../transactions/services/rate.service';
import { CurrentMerchant } from '../decorators/current-merchant.decorator';
import { MerchantDashboardQueryDto } from '../dto/merchant-dashboard-query.dto';
import {
  DashboardRateDto,
  MerchantDashboardDto,
  TurnoverPointDto,
} from '../dto/merchant-dashboard.dto';
import { MerchantScopeGuard } from '../guards/merchant-scope.guard';

const TURNOVER_SERIES_DAYS = 30;
const RAPIRA_CURRENCY = 'RUB';

@ApiTags('Merchant · Dashboard')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard, MerchantScopeGuard)
@Roles(Role.Merchant, Role.MerchantSupport, Role.MerchantAgent)
@Controller('merchant/dashboard')
export class MerchantDashboardController {
  private readonly logger = new Logger(MerchantDashboardController.name);

  constructor(
    private readonly stats: MerchantStatsService,
    private readonly balances: MerchantBalanceService,
    private readonly withdrawals: AccountTransactionsService,
    private readonly settings: MerchantSettingsService,
    private readonly currencies: MerchantCurrenciesService,
    private readonly rates: RateService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'The dashboard: balance and rate, withdrawals in progress, the period’s results and pay-ins',
    description:
      'Successful deals (success, success_changed) count by resolvedAt within the period; all time by default.',
  })
  @ApiEnvelopeResponse(MerchantDashboardDto)
  async read(
    @CurrentMerchant() merchantId: string,
    @Query() query: MerchantDashboardQueryDto,
  ): Promise<MerchantDashboardDto> {
    const period = dayPeriodRange(query, DayPeriod.AllTime, this.timeZone());
    const [totals, withdrawals, states, rate] = await Promise.all([
      this.stats.dashboardTotals(merchantId, period.from, period.to),
      this.withdrawals.merchantWithdrawalTotals(
        merchantId,
        period.from,
        period.to,
      ),
      this.balances.statesByMerchant([merchantId]),
      this.rateOf(merchantId),
    ]);
    const state = states.get(merchantId)!;
    const average =
      totals.successfulPayInCount === 0
        ? toCrypto(0)
        : roundCrypto(
            totals.successfulPayInAmount.div(totals.successfulPayInCount),
          );

    return {
      balance: {
        available: formatCrypto(state.balance),
        escrow: formatCrypto(state.escrow),
        rate,
      },
      withdrawals: {
        inProgressAmount: formatCrypto(withdrawals.inProgressAmount),
        inProgressCount: withdrawals.inProgressCount,
      },
      period,
      results: {
        turnover: formatCrypto(totals.turnover),
        creditedPayIn: formatCrypto(totals.creditedPayIn),
        payInCommission: formatCrypto(totals.payInCommission),
        withdrawn: formatCrypto(withdrawals.withdrawn),
      },
      payIns: {
        successfulCount: totals.successfulPayInCount,
        successfulAmount: formatCrypto(totals.successfulPayInAmount),
        averageAmount: formatCrypto(average),
      },
    };
  }

  @Get('turnover-series')
  @ApiOperation({
    summary:
      '«Оборот за последние 30 дней»: successful pay-ins and pay-outs per calendar day, USDT',
    description:
      'Today and the 29 days before in BUSINESS_TIMEZONE, by resolvedAt; an empty day is "0.000000". Independent of the dashboard’s period.',
  })
  @ApiEnvelopeResponse(TurnoverPointDto, { isArray: true })
  async turnoverSeries(
    @CurrentMerchant() merchantId: string,
  ): Promise<TurnoverPointDto[]> {
    return (
      await this.stats.turnoverSeries(
        merchantId,
        TURNOVER_SERIES_DAYS,
        this.timeZone(),
      )
    ).map((point) => ({ day: point.day, amount: formatCrypto(point.amount) }));
  }

  private async rateOf(merchantId: string): Promise<DashboardRateDto | null> {
    const [settings, currencies] = await Promise.all([
      this.settings.settingsOf(merchantId),
      this.currencies.currenciesByMerchant([merchantId]),
    ]);
    const currency = (currencies.get(merchantId) ?? []).find(
      (row) => row.currencyId === settings.defaultCurrencyId,
    );

    if (currency?.currency.isocode !== RAPIRA_CURRENCY) return null;

    try {
      const value = await this.rates.merchantSourceRate(
        currency.payInMarkupPercent,
      );

      return { currency: RAPIRA_CURRENCY, value: formatRate(value) };
    } catch (error) {
      this.logger.warn(
        `No rate for the dashboard: ${error instanceof Error ? error.message : String(error)}`,
      );

      return null;
    }
  }

  private timeZone(): string {
    return this.config.getOrThrow<string>('BUSINESS_TIMEZONE');
  }
}
