import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page } from '../../common/types/page';
import { formatCrypto } from '../../common/utils/format-crypto';
import { formatFiat } from '../../common/utils/format-fiat';
import { formatRate } from '../../common/utils/format-rate';
import { toFiat } from '../../common/utils/to-fiat';
import { toInstant } from '../../common/utils/to-instant';
import { CounterpartiesService } from '../../counterparties/services/counterparties.service';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { MerchantDealsService } from '../../transactions/services/merchant-deals.service';
import { MerchantDealFilter } from '../../transactions/types/merchant-deal-filter';
import { TransactionSortField } from '../../transactions/types/transaction-sort-field.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';
import { findTransactionMethod } from '../../transactions/utils/find-transaction-method';
import { CurrentMerchant } from '../decorators/current-merchant.decorator';
import { ListMerchantDealsQueryDto } from '../dto/list-merchant-deals-query.dto';
import { MerchantDealCountersDto } from '../dto/merchant-deal-counters.dto';
import { MerchantDealFilterDto } from '../dto/merchant-deal-filter.dto';
import {
  MerchantDealDetailDto,
  MerchantDealDto,
} from '../dto/merchant-deal.dto';
import { MerchantScopeGuard } from '../guards/merchant-scope.guard';
import { CABINET_EXPORT_MAX_ROWS } from '../utils/cabinet-export-max-rows';
import { merchantDealsCsv } from '../utils/merchant-deals-csv';

const SORT_FIELDS: Record<string, TransactionSortField> = {
  id: TransactionSortField.Id,
  createdAt: TransactionSortField.CreatedAt,
  expiresAt: TransactionSortField.ExpiresAt,
  amountFiat: TransactionSortField.AmountFiat,
  rate: TransactionSortField.Rate,
};

@ApiTags('Merchant · Deals')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard, MerchantScopeGuard)
@Roles(Role.Merchant, Role.MerchantSupport, Role.MerchantAgent)
@Controller('merchant/deals')
export class MerchantDealsController {
  constructor(
    private readonly deals: MerchantDealsService,
    private readonly bankDetails: BankDetailsService,
    private readonly counterparties: CounterpartiesService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'The merchant’s own deals',
    description:
      'Filters: status (a list — the tabs), kind, method, createdFrom/createdTo, amountFrom/amountTo (fiat), search (a piece of the deal number). The requisite is shown whole; the trader never.',
  })
  @ApiPagedResponse(MerchantDealDto)
  async list(
    @CurrentMerchant() merchantId: string,
    @Query() query: ListMerchantDealsQueryDto,
  ): Promise<Page<MerchantDealDto>> {
    const page = await this.deals.list(merchantId, {
      ...this.filterOf(query),
      page: query.page,
      limit: query.limit,
      sortBy: SORT_FIELDS[query.sortBy],
      sortOrder: query.sortOrder,
    });

    return new Page(await this.withDetails(page.items), page.meta);
  }

  @Get('counters')
  @ApiOperation({
    summary:
      'The tab counters under the list’s filters, and the three cards now',
  })
  @ApiEnvelopeResponse(MerchantDealCountersDto)
  async counters(
    @CurrentMerchant() merchantId: string,
    @Query() query: MerchantDealFilterDto,
  ): Promise<MerchantDealCountersDto> {
    const [tabs, now] = await Promise.all([
      this.deals.statusCounts(merchantId, {
        ...this.filterOf(query),
        statuses: undefined,
      }),
      this.deals.statusCounts(merchantId),
    ]);

    return {
      tabs: {
        all: Object.values(tabs).reduce((sum, count) => sum + count, 0),
        active: tabs[TransactionStatus.Active],
        pending: tabs[TransactionStatus.Pending],
        dispute:
          tabs[TransactionStatus.Dispute] +
          tabs[TransactionStatus.ManualReview],
        checking: tabs[TransactionStatus.Checking],
        checking_manually: tabs[TransactionStatus.CheckingManually],
        success_changed: tabs[TransactionStatus.SuccessChanged],
        success: tabs[TransactionStatus.Success],
        canceled: tabs[TransactionStatus.Canceled],
      },
      kpi: {
        active: now[TransactionStatus.Active],
        onCheck:
          now[TransactionStatus.Checking] +
          now[TransactionStatus.CheckingManually],
        pending: now[TransactionStatus.Pending],
      },
    };
  }

  @Get('export')
  @ApiOperation({
    summary: 'The deals under the same filters as CSV',
    description: `Newest first, comma-separated, UTF-8, CRLF. More than ${CABINET_EXPORT_MAX_ROWS} rows is a 400.`,
  })
  @ApiOkResponse({
    description: 'text/csv attachment, not wrapped in the response envelope',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  async export(
    @CurrentMerchant() merchantId: string,
    @Query() query: MerchantDealFilterDto,
  ): Promise<StreamableFile> {
    const rows = await this.deals.export(
      merchantId,
      this.filterOf(query),
      CABINET_EXPORT_MAX_ROWS,
    );
    const csv = merchantDealsCsv(await this.withDetails(rows));

    return new StreamableFile(Buffer.from(csv, 'utf-8'), {
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="deals.csv"',
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One of the merchant’s deals with its status history',
    description: 'Another merchant’s deal is a 404.',
  })
  @ApiEnvelopeResponse(MerchantDealDetailDto)
  async findOne(
    @CurrentMerchant() merchantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MerchantDealDetailDto> {
    const deal = await this.deals.findOwn(merchantId, id);
    const [[row], history] = await Promise.all([
      this.withDetails([deal]),
      this.deals.statusHistory(deal.id),
    ]);

    return {
      ...row,
      statusHistory: history.map((event) => ({
        fromStatus: event.fromStatus ?? null,
        toStatus: event.toStatus,
        createdAt: event.createdAt,
      })),
    };
  }

  private filterOf(query: MerchantDealFilterDto): MerchantDealFilter {
    const timeZone = this.config.getOrThrow<string>('BUSINESS_TIMEZONE');

    return {
      statuses: query.status,
      kind: query.kind,
      method: query.method,
      createdFrom: toInstant(query.createdFrom, timeZone),
      createdTo: toInstant(query.createdTo, timeZone),
      amountFrom:
        query.amountFrom === undefined ? undefined : toFiat(query.amountFrom),
      amountTo:
        query.amountTo === undefined ? undefined : toFiat(query.amountTo),
      idSearch: query.search,
    };
  }

  private async withDetails(rows: Transaction[]): Promise<MerchantDealDto[]> {
    const distinct = <T>(values: (T | null | undefined)[]): T[] => [
      ...new Set(
        values.filter(
          (value): value is T => value !== null && value !== undefined,
        ),
      ),
    ];
    const [requisites, counterparties] = await Promise.all([
      this.bankDetails.findByIdsWithDeleted(
        distinct(rows.map((row) => row.bankDetailsId)),
      ),
      this.counterparties.findByIds(
        distinct(rows.map((row) => row.counterpartyId)),
      ),
    ]);
    const requisiteById = new Map(requisites.map((row) => [row.id, row]));
    const counterpartyById = new Map(
      counterparties.map((row) => [row.id, row]),
    );

    return rows.map((row) => {
      const requisite = requisiteById.get(row.bankDetailsId);
      const counterparty = counterpartyById.get(row.counterpartyId);

      return {
        id: row.id,
        kind: row.kind,
        status: row.status,
        method: row.method ?? null,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt ?? null,
        resolvedAt: row.resolvedAt ?? null,
        amountFiat: formatFiat(row.amountFiat),
        currency: findTransactionMethod(row.method)?.currency ?? null,
        rate: formatRate(row.rate),
        amountCrypto: formatCrypto(row.amountCrypto),
        merchantAmount: formatCrypto(row.merchantAmount),
        merchantCommission: formatCrypto(row.merchantCommission),
        requisite: requisite
          ? {
              bank: { id: requisite.bank.id, name: requisite.bank.name },
              type: requisite.type,
              cardholderName: requisite.cardholderName ?? null,
              phone: requisite.phone ?? null,
              card: requisite.card ?? null,
            }
          : null,
        counterparty: counterparty
          ? { id: counterparty.id, name: counterparty.name ?? null }
          : null,
      };
    });
  }
}
