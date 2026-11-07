import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { BankDetailsService } from '../../bank-details/bank-details.service';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WriteAccess } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { formatCrypto } from '../../common/utils/format-crypto';
import { formatFiat } from '../../common/utils/format-fiat';
import { formatRate } from '../../common/utils/format-rate';
import { roundFiat } from '../../common/utils/round-fiat';
import { toFiat } from '../../common/utils/to-fiat';
import { CounterpartiesService } from '../../counterparties/services/counterparties.service';
import { MerchantsService } from '../../merchants/services/merchants.service';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { TraderDealActionsService } from '../../transactions/services/trader-deal-actions.service';
import { TraderDealsService } from '../../transactions/services/trader-deals.service';
import { TraderDealFilter } from '../../transactions/types/trader-deal-filter';
import { TransactionSortField } from '../../transactions/types/transaction-sort-field.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';
import { findTransactionMethod } from '../../transactions/utils/find-transaction-method';
import { ConfirmChangedDealDto } from '../dto/confirm-changed-deal.dto';
import { DeclineDealDto } from '../dto/decline-deal.dto';
import { ListTraderDealsQueryDto } from '../dto/list-trader-deals-query.dto';
import { TraderDealCountersDto } from '../dto/trader-deal-counters.dto';
import { TraderDealFilterDto } from '../dto/trader-deal-filter.dto';
import { TraderDealDetailDto, TraderDealDto } from '../dto/trader-deal.dto';
import { TraderDealSortField } from '../types/trader-deal-sort-field.enum';
import { traderActorOf } from '../utils/trader-actor-of';
import { traderCreatedRange } from '../utils/trader-created-range';
import { traderDealsCsv } from '../utils/trader-deals-csv';

const SORT_FIELDS: Record<TraderDealSortField, TransactionSortField> = {
  [TraderDealSortField.CreatedAt]: TransactionSortField.CreatedAt,
  [TraderDealSortField.ExpiresAt]: TransactionSortField.ExpiresAt,
  [TraderDealSortField.AmountFiat]: TransactionSortField.AmountFiat,
  [TraderDealSortField.Rate]: TransactionSortField.Rate,
  [TraderDealSortField.TraderCommission]: TransactionSortField.TraderCommission,
};

const distinct = <T>(values: (T | null | undefined)[]): T[] => [
  ...new Set(
    values.filter((value): value is T => value !== null && value !== undefined),
  ),
];

@ApiTags('Trader · Deals')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Trader)
@Controller('trader/deals')
export class TraderDealsController {
  constructor(
    private readonly deals: TraderDealsService,
    private readonly actions: TraderDealActionsService,
    private readonly bankDetails: BankDetailsService,
    private readonly merchants: MerchantsService,
    private readonly counterparties: CounterpartiesService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'The trader’s own pay-in deals',
    description:
      'Today by default. Filters: status (a list — the chips), period or createdFrom/createdTo, method, amountFrom/amountTo (fiat), bankDetailsId, merchantGroupId, counterparty, search (a piece of the deal number).',
  })
  @ApiPagedResponse(TraderDealDto)
  async list(
    @CurrentUser() trader: AuthenticatedUser,
    @Query() query: ListTraderDealsQueryDto,
  ): Promise<Page<TraderDealDto>> {
    const page = await this.deals.list(trader.id, {
      ...(await this.filterOf(query)),
      page: query.page,
      limit: query.limit,
      sortBy: SORT_FIELDS[query.sortBy],
      sortOrder: query.sortOrder,
    });

    return new Page(await this.withDetails(page.items), page.meta);
  }

  @Get('counters')
  @ApiOperation({
    summary: 'The chip counters under the list’s filters, status aside',
  })
  @ApiEnvelopeResponse(TraderDealCountersDto)
  async counters(
    @CurrentUser() trader: AuthenticatedUser,
    @Query() query: TraderDealFilterDto,
  ): Promise<TraderDealCountersDto> {
    const counts = await this.deals.statusCounts(
      trader.id,
      await this.filterOf(query),
    );

    return {
      all: Object.values(counts).reduce((sum, count) => sum + count, 0),
      active: counts[TransactionStatus.Active],
      dispute:
        counts[TransactionStatus.Dispute] +
        counts[TransactionStatus.ManualReview],
      checking: counts[TransactionStatus.Checking],
      checking_manually: counts[TransactionStatus.CheckingManually],
      success_changed: counts[TransactionStatus.SuccessChanged],
      success: counts[TransactionStatus.Success],
      canceled: counts[TransactionStatus.Canceled],
    };
  }

  @Get('export')
  @ApiOperation({
    summary: 'The deals under the same filters as CSV',
    description:
      'Newest first, comma-separated, UTF-8, CRLF. More than TRADER_EXPORT_MAX_ROWS rows is a 400.',
  })
  @ApiOkResponse({
    description: 'text/csv attachment, not wrapped in the response envelope',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  async export(
    @CurrentUser() trader: AuthenticatedUser,
    @Query() query: TraderDealFilterDto,
  ): Promise<StreamableFile> {
    const rows = await this.deals.export(
      trader.id,
      await this.filterOf(query),
      this.config.getOrThrow<number>('TRADER_EXPORT_MAX_ROWS'),
    );

    return new StreamableFile(
      Buffer.from(traderDealsCsv(await this.withDetails(rows)), 'utf-8'),
      {
        type: 'text/csv; charset=utf-8',
        disposition: 'attachment; filename="deals.csv"',
      },
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One of the trader’s deals',
    description: 'Another trader’s deal is a 404.',
  })
  @ApiEnvelopeResponse(TraderDealDetailDto)
  async findOne(
    @CurrentUser() trader: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TraderDealDetailDto> {
    return this.detailOf(await this.deals.findOwn(trader.id, id));
  }

  @Post(':id/confirm')
  @WriteAccess()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '«Завершить сделку»: active, checking or checking_manually → success',
    description:
      'Any other status is a 409. A repeat on success answers the same and moves nothing.',
  })
  @ApiEnvelopeResponse(TraderDealDetailDto)
  async confirm(
    @CurrentUser() trader: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TraderDealDetailDto> {
    return this.detailOf(await this.actions.confirm(traderActorOf(trader), id));
  }

  @Post(':id/confirm-changed')
  @WriteAccess()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '«Завершить с пересчетом»: closes the deal for the fiat actually received',
    description:
      'success_changed; every figure is recomputed at the deal’s rate and percents. More than the deal needs more escrow: not enough available is a 409 INSUFFICIENT_BALANCE; less returns the surplus. A repeat with the same amount answers the same.',
  })
  @ApiEnvelopeResponse(TraderDealDetailDto)
  async confirmChanged(
    @CurrentUser() trader: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmChangedDealDto,
  ): Promise<TraderDealDetailDto> {
    return this.detailOf(
      await this.actions.confirmChanged(
        traderActorOf(trader),
        id,
        toFiat(dto.amount),
      ),
    );
  }

  @Post(':id/decline')
  @WriteAccess()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Declines an active deal with a reason: canceled, escrow released',
    description:
      'Any other status is a 409. requisite_blocked also switches the requisite off.',
  })
  @ApiEnvelopeResponse(TraderDealDetailDto)
  async decline(
    @CurrentUser() trader: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineDealDto,
  ): Promise<TraderDealDetailDto> {
    return this.detailOf(
      await this.actions.decline(
        traderActorOf(trader),
        id,
        dto.reasonCode,
        dto.comment ?? null,
      ),
    );
  }

  private async filterOf(
    query: TraderDealFilterDto,
  ): Promise<TraderDealFilter> {
    const timeZone = this.config.getOrThrow<string>('BUSINESS_TIMEZONE');
    const [merchantIds, counterpartyIds] = await Promise.all([
      query.merchantGroupId === undefined
        ? undefined
        : this.merchants.findIdsOfGroup(query.merchantGroupId),
      query.counterparty === undefined
        ? undefined
        : this.counterparties.findIdsByReference(query.counterparty),
    ]);

    return {
      ...traderCreatedRange(query, timeZone),
      statuses: query.status,
      method: query.method,
      amountFrom:
        query.amountFrom === undefined ? undefined : toFiat(query.amountFrom),
      amountTo:
        query.amountTo === undefined ? undefined : toFiat(query.amountTo),
      bankDetailsIds:
        query.bankDetailsId === undefined ? undefined : [query.bankDetailsId],
      merchantIds,
      counterpartyIds,
      idSearch: query.search,
    };
  }

  private async detailOf(deal: Transaction): Promise<TraderDealDetailDto> {
    const [[row], tags] = await Promise.all([
      this.withDetails([deal]),
      this.bankDetails.tagsOf([deal.bankDetailsId]),
    ]);

    return {
      ...row,
      traderAmount: formatCrypto(deal.traderAmount),
      traderEffectivePercent: deal.traderEffectivePercent,
      tags: (tags.get(deal.bankDetailsId) ?? []).map((tag) => ({
        id: tag.id,
        name: tag.name,
      })),
      originalAmountFiat: deal.originalAmountFiat
        ? formatFiat(deal.originalAmountFiat)
        : null,
      declineReasonCode: deal.declineReasonCode ?? null,
      declineComment: deal.declineComment ?? null,
    };
  }

  private async withDetails(rows: Transaction[]): Promise<TraderDealDto[]> {
    const [requisites, groups] = await Promise.all([
      this.bankDetails.findByIdsWithDeleted(
        distinct(rows.map((row) => row.bankDetailsId)),
      ),
      this.merchants.groupsOf(distinct(rows.map((row) => row.merchantId))),
    ]);
    const requisiteById = new Map(requisites.map((row) => [row.id, row]));

    return rows.map((row) => {
      const requisite = requisiteById.get(row.bankDetailsId);
      const group = row.merchantId ? groups.get(row.merchantId) : undefined;

      return {
        id: row.id,
        status: row.status,
        method: row.method ?? null,
        currency: findTransactionMethod(row.method)?.currency ?? null,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt ?? null,
        resolvedAt: row.resolvedAt ?? null,
        amountFiat: formatFiat(row.amountFiat),
        rate: formatRate(row.rate),
        requisite: requisite
          ? {
              id: requisite.id,
              bank: requisite.bank
                ? { id: requisite.bank.id, name: requisite.bank.name }
                : null,
              mobileOperator: requisite.mobileOperator
                ? {
                    id: requisite.mobileOperator.id,
                    name: requisite.mobileOperator.name,
                  }
                : null,
              type: requisite.type,
              cardholderName: requisite.cardholderName ?? null,
              phone: requisite.phone ?? null,
              card: requisite.card ?? null,
            }
          : null,
        counterpartyId: row.counterpartyId ?? null,
        merchantGroup: group ? { id: group.id, name: group.name } : null,
        profit: formatCrypto(row.traderCommission),
        profitFiat: formatFiat(roundFiat(row.traderCommission.times(row.rate))),
      };
    });
  }
}
