import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { BanksService } from '../../banks/banks.service';
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
import { toCrypto } from '../../common/utils/to-crypto';
import { toFiat } from '../../common/utils/to-fiat';
import { MerchantAttachmentsService } from '../../merchants/services/merchant-attachments.service';
import { MerchantsService } from '../../merchants/services/merchants.service';
import { TraderSettingsService } from '../../trader-settings/trader-settings.service';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { PayoutPricingService } from '../../transactions/services/payout-pricing.service';
import { TraderPayoutActionsService } from '../../transactions/services/trader-payout-actions.service';
import { TraderPayoutsService } from '../../transactions/services/trader-payouts.service';
import { TransactionFilesService } from '../../transactions/services/transaction-files.service';
import { WalletService } from '../../transactions/services/wallet.service';
import { TraderPayoutFilter } from '../../transactions/types/trader-payout-filter';
import { TransactionSortField } from '../../transactions/types/transaction-sort-field.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';
import { findTransactionMethod } from '../../transactions/utils/find-transaction-method';
import { DeclinePayoutDto } from '../dto/decline-payout.dto';
import { ListPayoutPoolQueryDto } from '../dto/list-payout-pool-query.dto';
import { ListTraderPayoutsQueryDto } from '../dto/list-trader-payouts-query.dto';
import { TraderPayoutCountersDto } from '../dto/trader-payout-counters.dto';
import { TraderPayoutFilterDto } from '../dto/trader-payout-filter.dto';
import {
  TraderPayoutDetailDto,
  TraderPayoutDto,
} from '../dto/trader-payout.dto';
import { TraderPayoutSortField } from '../types/trader-payout-sort-field.enum';
import { traderActorOf } from '../utils/trader-actor-of';
import { traderCreatedRange } from '../utils/trader-created-range';
import { traderPayoutsCsv } from '../utils/trader-payouts-csv';

const SORT_FIELDS: Record<TraderPayoutSortField, TransactionSortField> = {
  [TraderPayoutSortField.CreatedAt]: TransactionSortField.CreatedAt,
  [TraderPayoutSortField.ExpiresAt]: TransactionSortField.ExpiresAt,
  [TraderPayoutSortField.AmountFiat]: TransactionSortField.AmountFiat,
  [TraderPayoutSortField.Rate]: TransactionSortField.Rate,
  [TraderPayoutSortField.TraderCommission]:
    TransactionSortField.TraderCommission,
};
const EMPTY_POOL_META = (query: ListPayoutPoolQueryDto) => ({
  total: 0,
  page: query.page,
  limit: query.limit,
  pages: 0,
});

const distinct = <T>(values: (T | null | undefined)[]): T[] => [
  ...new Set(
    values.filter((value): value is T => value !== null && value !== undefined),
  ),
];

@ApiTags('Trader · Pay-outs')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Trader)
@Controller('trader/payouts')
export class TraderPayoutsController {
  constructor(
    private readonly payouts: TraderPayoutsService,
    private readonly actions: TraderPayoutActionsService,
    private readonly pricing: PayoutPricingService,
    private readonly files: TransactionFilesService,
    private readonly settings: TraderSettingsService,
    private readonly wallets: WalletService,
    private readonly attachments: MerchantAttachmentsService,
    private readonly merchants: MerchantsService,
    private readonly banks: BanksService,
    private readonly config: ConfigService,
  ) {}

  @Get('available')
  @ApiOperation({
    summary: '«Доступные»: the pool of untaken pay-outs this trader may take',
    description:
      'A 403 PAYOUTS_ACCESS_DISABLED when the access is off; empty when the pay-out insurance is below its minimum. The recipient is shown whole. A pay-out that passes the insurance room here can still be refused by take once it is priced exactly.',
  })
  @ApiPagedResponse(TraderPayoutDto)
  async available(
    @CurrentUser() trader: AuthenticatedUser,
    @Query() query: ListPayoutPoolQueryDto,
  ): Promise<Page<TraderPayoutDto>> {
    const now = new Date();
    const settings = await this.settings.findOrDefaults(trader.id);

    if (!settings.payoutTradingEnabled) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'PAYOUTS_ACCESS_DISABLED',
        message: 'Pay-outs are switched off for this trader',
      });
    }

    const wallet = await this.wallets.findByUserId(trader.id);
    const belowMinimum = (wallet?.insurancePayOutBalance ?? toCrypto(0)).lt(
      this.settings.insurancePayOutMinOf(settings),
    );
    const room = settings.trustedUser
      ? null
      : await this.actions.insuranceRoomOf(wallet, trader.id, now);

    if (belowMinimum || room?.lte(0)) {
      return new Page([], EMPTY_POOL_META(query));
    }

    const [exclusions, merchantIds] = await Promise.all([
      this.attachments.exclusionsOfTrader(trader.id),
      query.merchantGroupId === undefined
        ? undefined
        : this.merchants.findIdsOfGroup(query.merchantGroupId),
    ]);
    const page = await this.payouts.pool(
      {
        method: query.method,
        amountFrom:
          query.amountFrom === undefined ? undefined : toFiat(query.amountFrom),
        amountTo:
          query.amountTo === undefined ? undefined : toFiat(query.amountTo),
        idSearch: query.search,
        merchantIds,
        page: query.page,
        limit: query.limit,
        sortBy: SORT_FIELDS[query.sortBy],
        sortOrder: query.sortOrder,
      },
      exclusions,
      room,
      now,
    );
    const rows = await this.withDetails(page.items);

    return new Page(
      await Promise.all(
        page.items.map(async (deal, index) => {
          const price = await this.pricing.priceFor(
            deal,
            trader.id,
            settings.individualRatesEnabled,
          );

          return {
            ...rows[index],
            traderAmount: price ? formatCrypto(price.traderAmount) : null,
            profit: price ? formatCrypto(price.traderCommission) : null,
            profitFiat: price
              ? formatFiat(roundFiat(price.traderCommission.times(deal.rate)))
              : null,
          };
        }),
      ),
      page.meta,
    );
  }

  @Get()
  @ApiOperation({
    summary: 'The trader’s own taken pay-outs',
    description:
      'Today by default. Filters: status (a list), period or createdFrom/createdTo, method, amountFrom/amountTo, merchantGroupId, search.',
  })
  @ApiPagedResponse(TraderPayoutDto)
  async list(
    @CurrentUser() trader: AuthenticatedUser,
    @Query() query: ListTraderPayoutsQueryDto,
  ): Promise<Page<TraderPayoutDto>> {
    const page = await this.payouts.list(trader.id, {
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
  @ApiEnvelopeResponse(TraderPayoutCountersDto)
  async counters(
    @CurrentUser() trader: AuthenticatedUser,
    @Query() query: TraderPayoutFilterDto,
  ): Promise<TraderPayoutCountersDto> {
    const counts = await this.payouts.statusCounts(
      trader.id,
      await this.filterOf(query),
    );

    return {
      all: Object.values(counts).reduce((sum, count) => sum + count, 0),
      active: counts[TransactionStatus.Active],
      checking: counts[TransactionStatus.Checking],
      dispute:
        counts[TransactionStatus.Dispute] +
        counts[TransactionStatus.ManualReview],
      completed:
        counts[TransactionStatus.Success] +
        counts[TransactionStatus.SuccessChanged],
      canceled: counts[TransactionStatus.Canceled],
    };
  }

  @Get('export')
  @ApiOperation({
    summary: 'The taken pay-outs under the same filters as CSV',
    description:
      'Newest first, comma-separated, UTF-8, CRLF. More than TRADER_EXPORT_MAX_ROWS rows is a 400.',
  })
  @ApiOkResponse({
    description: 'text/csv attachment, not wrapped in the response envelope',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  async export(
    @CurrentUser() trader: AuthenticatedUser,
    @Query() query: TraderPayoutFilterDto,
  ): Promise<StreamableFile> {
    const rows = await this.payouts.export(
      trader.id,
      await this.filterOf(query),
      this.config.getOrThrow<number>('TRADER_EXPORT_MAX_ROWS'),
    );

    return new StreamableFile(
      Buffer.from(traderPayoutsCsv(await this.withDetails(rows)), 'utf-8'),
      {
        type: 'text/csv; charset=utf-8',
        disposition: 'attachment; filename="payouts.csv"',
      },
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One of the trader’s taken pay-outs, with its receipts',
    description: 'A pay-out the trader does not hold is a 404.',
  })
  @ApiEnvelopeResponse(TraderPayoutDetailDto)
  async findOne(
    @CurrentUser() trader: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TraderPayoutDetailDto> {
    return this.detailOf(await this.payouts.findOwn(trader.id, id));
  }

  @Post(':id/take')
  @WriteAccess()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '«Взять в работу»: pending → active, the trader’s price is fixed',
    description:
      '409: ALREADY_TAKEN · PAYOUT_ACTIVE_LIMIT · PAYOUT_INSURANCE_LIMIT · RATE_NOT_FOUND. 403: PAYOUTS_ACCESS_DISABLED · INSURANCE_BELOW_MINIMUM. A merchant the trader is not admitted to is a 404.',
  })
  @ApiEnvelopeResponse(TraderPayoutDetailDto)
  async take(
    @CurrentUser() trader: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TraderPayoutDetailDto> {
    return this.detailOf(await this.actions.take(traderActorOf(trader), id));
  }

  @Post(':id/complete')
  @WriteAccess()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: '«Выполнено» with the receipt: active → checking («На проверке»)',
    description:
      'The receipt is required: pdf, png, jpeg, heic, heif, mp4, mov, 3gp, avi, mkv, webm or mpeg, recognised by its content. Over DISPUTE_FILE_MAX_BYTES is a 413. Success follows by itself after PAYOUT_REVIEW_MINUTES.',
  })
  @ApiEnvelopeResponse(TraderPayoutDetailDto)
  async complete(
    @CurrentUser() trader: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<TraderPayoutDetailDto> {
    if (!file) throw new BadRequestException('The receipt file is required');

    return this.detailOf(
      await this.actions.complete(traderActorOf(trader), id, {
        buffer: file.buffer,
        name: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      }),
    );
  }

  @Post(':id/decline')
  @WriteAccess()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '«Отказ от заявки»: back to the pool with a reason',
    description:
      'From active only; after the receipt is a 409, because the money has already gone.',
  })
  @ApiEnvelopeResponse(TraderPayoutDto)
  async decline(
    @CurrentUser() trader: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclinePayoutDto,
  ): Promise<TraderPayoutDto> {
    const [row] = await this.withDetails([
      await this.actions.decline(
        traderActorOf(trader),
        id,
        dto.reasonCode,
        dto.comment ?? null,
      ),
    ]);

    return row;
  }

  private async filterOf(
    query: TraderPayoutFilterDto,
  ): Promise<TraderPayoutFilter> {
    return {
      ...traderCreatedRange(
        query,
        this.config.getOrThrow<string>('BUSINESS_TIMEZONE'),
      ),
      statuses: query.status,
      method: query.method,
      amountFrom:
        query.amountFrom === undefined ? undefined : toFiat(query.amountFrom),
      amountTo:
        query.amountTo === undefined ? undefined : toFiat(query.amountTo),
      merchantIds:
        query.merchantGroupId === undefined
          ? undefined
          : await this.merchants.findIdsOfGroup(query.merchantGroupId),
      idSearch: query.search,
    };
  }

  private async detailOf(deal: Transaction): Promise<TraderPayoutDetailDto> {
    const [[row], receipts] = await Promise.all([
      this.withDetails([deal]),
      this.files.listOf([deal.id]),
    ]);

    return {
      ...row,
      traderEffectivePercent: deal.traderEffectivePercent ?? null,
      receipts: receipts.map((file) => ({
        id: file.id,
        name: file.name,
        mime: file.mime,
        size: file.size,
        createdAt: file.createdAt,
      })),
    };
  }

  private async withDetails(rows: Transaction[]): Promise<TraderPayoutDto[]> {
    const [banks, groups] = await Promise.all([
      this.banks.findByIds(distinct(rows.map((row) => row.payoutBankId))),
      this.merchants.groupsOf(distinct(rows.map((row) => row.merchantId))),
    ]);
    const bankById = new Map(banks.map((bank) => [bank.id, bank]));

    return rows.map((row) => {
      const bank =
        row.payoutBankId === null ? undefined : bankById.get(row.payoutBankId);
      const group = groups.get(row.merchantId);
      const profit = row.traderCommission ?? null;

      return {
        id: row.id,
        status: row.status,
        method: row.method ?? null,
        currency: findTransactionMethod(row.method)?.currency ?? null,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt ?? null,
        takenAt: row.payoutTakenAt ?? null,
        paymentDeadlineAt: row.payoutDeadlineAt ?? null,
        completedAt: row.payoutCompletedAt ?? null,
        resolvedAt: row.resolvedAt ?? null,
        amountFiat: formatFiat(row.amountFiat),
        rate: formatRate(row.rate),
        recipient: {
          bank: bank ? { id: bank.id, name: bank.name } : null,
          ownerName: row.payoutOwnerName ?? null,
          cardNumber: row.payoutCardNumber ?? null,
          phone: row.payoutPhone ?? null,
        },
        merchantGroup: group ? { id: group.id, name: group.name } : null,
        traderAmount: row.traderAmount ? formatCrypto(row.traderAmount) : null,
        profit: profit ? formatCrypto(profit) : null,
        profitFiat: profit
          ? formatFiat(roundFiat(profit.times(row.rate)))
          : null,
      };
    });
  }
}
