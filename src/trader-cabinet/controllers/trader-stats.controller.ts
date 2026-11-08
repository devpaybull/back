import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DayPeriod } from '../../common/enums/day-period.enum';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { AuthenticatedUser } from '../../common/types/token';
import { averageCheckOf } from '../../common/utils/average-check-of';
import { dayPeriodRange } from '../../common/utils/day-period-range';
import { formatCrypto } from '../../common/utils/format-crypto';
import { formatFiat } from '../../common/utils/format-fiat';
import { formatRate } from '../../common/utils/format-rate';
import { percentOf } from '../../common/utils/percent-of';
import { roundRate } from '../../common/utils/round-rate';
import { toDecimal } from '../../common/utils/to-decimal';
import { TraderStatsService } from '../../transactions/services/trader-stats.service';
import { TraderStatsFilter } from '../../transactions/types/trader-stats-filter';
import { TraderStatsBucketDto } from '../dto/trader-stats-bucket.dto';
import { TraderStatsDayDto } from '../dto/trader-stats-day.dto';
import { TraderStatsFilterDto } from '../dto/trader-stats-filter.dto';
import { TraderStatsQueryDto } from '../dto/trader-stats-query.dto';
import { TraderStatsSummaryDto } from '../dto/trader-stats-summary.dto';

const FILTERS =
  'Filters: direction, method, bankDetailsId (one of the trader’s requisites).';
const PERIOD =
  'period (default today) or periodFrom/periodTo, days of BUSINESS_TIMEZONE.';

@ApiTags('Trader · Statistics')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Trader)
@Controller('trader/stats')
export class TraderStatsController {
  constructor(
    private readonly stats: TraderStatsService,
    private readonly config: ConfigService,
  ) {}

  @Get('summary')
  @ApiOperation({
    summary: 'The four cards and «Реагирование» of the statistics page',
    description: `${PERIOD} ${FILTERS} «Конверсия выдачи» reads the selection journal, which keeps SELECTION_ATTEMPTS_RETENTION_DAYS; a pay-out direction has none.`,
  })
  @ApiEnvelopeResponse(TraderStatsSummaryDto)
  async summary(
    @CurrentUser() trader: AuthenticatedUser,
    @Query() query: TraderStatsQueryDto,
  ): Promise<TraderStatsSummaryDto> {
    const totals = await this.stats.summary(
      trader.id,
      dayPeriodRange(query, DayPeriod.Today, this.timeZone()),
      this.filterOf(query),
    );

    return {
      issue: {
        issued: totals.issued,
        skipped: totals.skipped,
        percent: percentOf(totals.issued, totals.issued + totals.skipped),
      },
      payment: {
        paid: totals.paid,
        canceled: totals.canceled,
        percent: percentOf(totals.paid, totals.paid + totals.canceled),
      },
      turnover: {
        amount: formatFiat(totals.turnover),
        count: totals.successCount,
        averageCheck: averageCheckOf(totals.turnover, totals.successCount),
      },
      income: {
        amount: formatCrypto(totals.income),
        averageRate: totals.volumeCrypto.isZero()
          ? null
          : formatRate(
              roundRate(toDecimal(totals.turnover).div(totals.volumeCrypto)),
            ),
      },
      response: {
        depositSeconds: totals.depositSeconds,
        payoutSeconds: totals.payoutSeconds,
        disputeSeconds: totals.disputeSeconds,
      },
    };
  }

  @Get('daily')
  @ApiOperation({
    summary: 'The 14-day charts: income, turnover, conversion, disputes',
    description: `Today and the 13 days before, every day present. ${FILTERS}`,
  })
  @ApiEnvelopeResponse(TraderStatsDayDto, { isArray: true })
  async daily(
    @CurrentUser() trader: AuthenticatedUser,
    @Query() query: TraderStatsFilterDto,
  ): Promise<TraderStatsDayDto[]> {
    const days = await this.stats.daily(
      trader.id,
      this.filterOf(query),
      this.timeZone(),
    );

    return days.map((day) => ({
      date: day.day,
      income: formatCrypto(day.income),
      turnover: formatFiat(day.turnover),
      conversionPercent: percentOf(day.paid, day.paid + day.canceled),
      disputePercent: percentOf(day.disputed, day.created),
    }));
  }

  @Get('buckets')
  @ApiOperation({
    summary: 'Successful deals by the size of the cheque: count and volume',
    description: `Five buckets of amountFiat, the same for every currency, always all five. ${PERIOD} ${FILTERS}`,
  })
  @ApiEnvelopeResponse(TraderStatsBucketDto, { isArray: true })
  async buckets(
    @CurrentUser() trader: AuthenticatedUser,
    @Query() query: TraderStatsQueryDto,
  ): Promise<TraderStatsBucketDto[]> {
    const buckets = await this.stats.buckets(
      trader.id,
      dayPeriodRange(query, DayPeriod.Today, this.timeZone()),
      this.filterOf(query),
    );

    return buckets.map((bucket) => ({
      range: bucket.label,
      count: bucket.count,
      volumeCrypto: formatCrypto(bucket.volumeCrypto),
      volumeFiat: formatFiat(bucket.volumeFiat),
    }));
  }

  private filterOf(query: TraderStatsFilterDto): TraderStatsFilter {
    return {
      kind: query.direction,
      method: query.method,
      bankDetailsId: query.bankDetailsId,
    };
  }

  private timeZone(): string {
    return this.config.getOrThrow<string>('BUSINESS_TIMEZONE');
  }
}
