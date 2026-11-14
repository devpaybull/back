import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { BankDetailsService } from '../../bank-details/bank-details.service';
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
import { attachmentDisposition } from '../../common/utils/attachment-disposition';
import { createdRange } from '../../common/utils/created-range';
import { formatCrypto } from '../../common/utils/format-crypto';
import { formatFiat } from '../../common/utils/format-fiat';
import { loginOf } from '../../common/utils/login-of';
import { toFiat } from '../../common/utils/to-fiat';
import { CounterpartiesService } from '../../counterparties/services/counterparties.service';
import {
  MerchantCallbackDto,
  toMerchantCallbackDto,
} from '../../merchant-callbacks/dto/merchant-callback.dto';
import { MerchantsService } from '../../merchants/services/merchants.service';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { AdminDealActionsService } from '../../transactions/services/admin-deal-actions.service';
import { DisputesService } from '../../transactions/services/disputes.service';
import { TraderPayoutActionsService } from '../../transactions/services/trader-payout-actions.service';
import { TransactionCardService } from '../../transactions/services/transaction-card.service';
import { TransactionFilesService } from '../../transactions/services/transaction-files.service';
import { TransactionService } from '../../transactions/services/transaction.service';
import { StatusEventSource } from '../../transactions/types/status-event-source.enum';
import { TransactionCard } from '../../transactions/types/transaction-card';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionListQuery } from '../../transactions/types/transaction-list-query';
import { TransactionSortField } from '../../transactions/types/transaction-sort-field.enum';
import { TransactionTextMatch } from '../../transactions/types/transaction-text-match';
import { findTransactionMethod } from '../../transactions/utils/find-transaction-method';
import { TRANSACTION_METHODS } from '../../transactions/utils/transaction-methods';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { AdminDealCorrectionDto } from '../dto/admin-deal-correction.dto';
import { AdminTransactionCardDto } from '../dto/admin-transaction-card.dto';
import { AssignPayoutTraderDto } from '../dto/assign-payout-trader.dto';
import { CancelPayoutDto } from '../dto/cancel-payout.dto';
import { CardHistoryEntryDto } from '../dto/card-history-entry.dto';
import { ChangeDealAmountDto } from '../dto/change-deal-amount.dto';
import { ChangeTransactionStatusDto } from '../dto/change-transaction-status.dto';
import { ListTransactionsQueryDto } from '../dto/list-transactions-query.dto';
import { OpenAdminDisputeDto } from '../dto/open-admin-dispute.dto';
import { TransactionFileDto } from '../dto/transaction-file.dto';
import { TransactionFilterDto } from '../dto/transaction-filter.dto';
import {
  toTransactionListItemDto,
  TransactionListItemDto,
} from '../dto/transaction-list-item.dto';
import { TransactionMethodCountersDto } from '../dto/transaction-method-counters.dto';
import { toTransactionDto, TransactionDto } from '../dto/transaction.dto';
import { CardHistoryKind } from '../types/card-history-kind.enum';
import { adminDealsCsv } from '../utils/admin-deals-csv';
import { canIssueRole } from '../utils/can-issue-role';

type TransactionFilter = Omit<
  TransactionListQuery,
  'page' | 'limit' | 'sortBy' | 'sortOrder'
> &
  TransactionTextMatch;

const distinct = <T>(values: (T | null | undefined)[]): T[] => [
  ...new Set(
    values.filter((value): value is T => value !== null && value !== undefined),
  ),
];

const toFileDto = (
  file: TransactionCard['files'][number],
): TransactionFileDto => ({
  id: file.id,
  kind: file.kind,
  name: file.name,
  mime: file.mime,
  size: file.size,
  uploadedByUserId: file.uploadedByUserId,
  createdAt: file.createdAt,
});

@ApiTags('Admin · Transactions')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/transactions')
export class AdminTransactionsController {
  constructor(
    private readonly transactions: TransactionService,
    private readonly directory: UserDirectoryService,
    private readonly bankDetails: BankDetailsService,
    private readonly merchants: MerchantsService,
    private readonly counterparties: CounterpartiesService,
    private readonly config: ConfigService,
    private readonly files: TransactionFilesService,
    private readonly banks: BanksService,
    private readonly cards: TransactionCardService,
    private readonly dealActions: AdminDealActionsService,
    private readonly payoutActions: TraderPayoutActionsService,
    private readonly disputes: DisputesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Lists deals and pay-outs across every account',
    description:
      'status is a list; period or createdFrom/createdTo (both a 400), none of them is all time; search is a piece of our id or of merchantTransactionId; counterparty an id or payerInfo.userId; requisite a piece of a card, phone or holder.',
  })
  @ApiPagedResponse(TransactionListItemDto)
  async list(
    @Query() query: ListTransactionsQueryDto,
  ): Promise<Page<TransactionListItemDto>> {
    const [filter, merchantRanks] = await Promise.all([
      this.filterOf(query),
      query.sortBy === TransactionSortField.Merchant
        ? this.merchants.rankByName()
        : undefined,
    ]);
    const page = await this.transactions.list({
      ...filter,
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      merchantRanks,
    });

    return new Page(await this.withDetails(page.items), page.meta);
  }

  @Get('counters')
  @ApiOperation({
    summary: 'The method tabs: how many rows each method has under the filters',
    description: 'Every filter of the list applies except method.',
  })
  @ApiEnvelopeResponse(TransactionMethodCountersDto)
  async counters(
    @Query() query: TransactionFilterDto,
  ): Promise<TransactionMethodCountersDto> {
    const counts = await this.transactions.countsByMethod({
      ...(await this.filterOf(query)),
      method: undefined,
    });
    const byMethod = Object.fromEntries(
      TRANSACTION_METHODS.filter(
        (method) =>
          !query.kind ||
          (method.directions as readonly TransactionKind[]).includes(
            query.kind,
          ),
      ).map((method) => [method.code, counts.get(method.code) ?? 0]),
    );

    return {
      all: [...counts.values()].reduce((sum, count) => sum + count, 0),
      byMethod,
    };
  }

  @Get('export')
  @ApiOperation({
    summary: 'The rows of the list as CSV («Выгрузка»)',
    description:
      'The list’s filters; more than ADMIN_EXPORT_MAX_ROWS rows is a 400.',
  })
  @ApiOkResponse({ description: 'text/csv, not wrapped in the envelope' })
  async export(@Query() query: TransactionFilterDto): Promise<StreamableFile> {
    const rows = await this.transactions.listForExport(
      await this.filterOf(query),
      this.config.getOrThrow<number>('ADMIN_EXPORT_MAX_ROWS'),
    );
    const details = await this.withDetails(rows);

    return new StreamableFile(
      Buffer.from(
        adminDealsCsv(
          details.map((row, index) => ({
            ...row,
            currency:
              findTransactionMethod(rows[index].method)?.currency ?? null,
            payerUserId: rows[index].payerInfo?.userId ?? null,
          })),
        ),
        'utf-8',
      ),
      {
        type: 'text/csv; charset=utf-8',
        disposition: 'attachment; filename="transactions.csv"',
      },
    );
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'The deal card: figures, parties, lead shares, files, history and the actions open now',
  })
  @ApiEnvelopeResponse(AdminTransactionCardDto)
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<AdminTransactionCardDto> {
    return this.cardDto(
      await this.cards.cardOf(id, admin.role === Role.Superadmin),
    );
  }

  @Get(':id/files')
  @ApiOperation({
    summary: 'The files of a deal, a pay-out’s receipts among them',
  })
  @ApiEnvelopeResponse(TransactionFileDto, { isArray: true })
  async listFiles(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TransactionFileDto[]> {
    return (await this.files.listOf([id])).map(toFileDto);
  }

  @Get(':id/files/:fileId')
  @ApiOperation({
    summary: 'Downloads a file of a deal',
    description: 'Always an attachment.',
  })
  @ApiOkResponse({ description: 'The file, not wrapped in the envelope' })
  async downloadFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<StreamableFile> {
    const { file, body } = await this.files.download(id, fileId);

    return new StreamableFile(body, {
      type: file.mime,
      disposition: attachmentDisposition(file.name),
    });
  }

  @Patch(':id/status')
  @WriteAccess()
  @ApiOperation({ summary: 'Changes a transaction status' })
  @ApiEnvelopeResponse(TransactionDto)
  async changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeTransactionStatusDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<TransactionDto> {
    await this.assertMayActOn(admin, id);

    const updated = await this.transactions.transition(id, {
      toStatus: dto.status,
      source: StatusEventSource.Admin,
      actorUserId: admin.id,
      reason: dto.reason,
    });

    return toTransactionDto(updated);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @ApiOperation({
    summary:
      '«Закрыть активную сделку»: confirms an open pay-in on its full amount',
    description:
      'active · checking · checking_manually → success, money as when the trader confirms. 409 DEAL_NOT_CLOSABLE, DEAL_UNDER_DISPUTE.',
  })
  @ApiEnvelopeResponse(TransactionDto)
  async close(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<TransactionDto> {
    await this.assertMayActOn(admin, id);

    return toTransactionDto(
      await this.dealActions.close({ userId: admin.id }, id),
    );
  }

  @Post(':id/amount')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @Roles(Role.Superadmin)
  @ApiOperation({
    summary: '«Изменить сумму сделки» (superadmin)',
    description:
      'A completed pay-in or pay-out → success_changed, repriced at its rate; only the difference moves for the trader, the leads and the merchant. Any number of times, at any age; the first amount stays in original*. 409 DEAL_NOT_SETTLED, DEAL_UNDER_DISPUTE, OVERDRAFT_NOT_CONFIRMED.',
  })
  @ApiEnvelopeResponse(TransactionDto)
  async changeAmount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeDealAmountDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<TransactionDto> {
    await this.assertMayActOn(admin, id);

    return toTransactionDto(
      await this.dealActions.changeAmount({ userId: admin.id }, id, {
        amountFiat: toFiat(dto.amountFiat),
        reason: dto.reason,
        confirmOverdraft: dto.confirmOverdraft ?? false,
      }),
    );
  }

  @Post(':id/cancel-settled')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @Roles(Role.Superadmin)
  @ApiOperation({
    summary: '«Отменить завершенную сделку» (superadmin)',
    description:
      'success · success_changed → canceled; every movement of the deal is reversed (a pay-out mirrored: the trader returns the USDT, the merchant gets it back). 409 DEAL_NOT_SETTLED, DEAL_UNDER_DISPUTE, OVERDRAFT_NOT_CONFIRMED.',
  })
  @ApiEnvelopeResponse(TransactionDto)
  async cancelSettled(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminDealCorrectionDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<TransactionDto> {
    await this.assertMayActOn(admin, id);

    return toTransactionDto(
      await this.dealActions.cancelSettled({ userId: admin.id }, id, {
        reason: dto.reason,
        confirmOverdraft: dto.confirmOverdraft ?? false,
      }),
    );
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @Roles(Role.Superadmin)
  @ApiOperation({
    summary:
      'The button on a canceled pay-in: settles it after all (superadmin)',
    description:
      'canceled → success (success_changed when its amount was changed before), money as when the trader confirms, taken from main. 409 DEAL_NOT_RESTORABLE, DEAL_UNDER_DISPUTE, OVERDRAFT_NOT_CONFIRMED.',
  })
  @ApiEnvelopeResponse(TransactionDto)
  async restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminDealCorrectionDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<TransactionDto> {
    await this.assertMayActOn(admin, id);

    return toTransactionDto(
      await this.dealActions.restore({ userId: admin.id }, id, {
        reason: dto.reason,
        confirmOverdraft: dto.confirmOverdraft ?? false,
      }),
    );
  }

  @Post(':id/cancel-payout')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @ApiOperation({
    summary: '«Отменить откуп»',
    description:
      'A pending or taken pay-out → canceled; the merchant’s hold returns. 409 PAYOUT_NOT_CANCELABLE, DEAL_UNDER_DISPUTE.',
  })
  @ApiEnvelopeResponse(TransactionDto)
  async cancelPayout(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelPayoutDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<TransactionDto> {
    await this.assertMayActOn(admin, id);

    return toTransactionDto(
      await this.dealActions.cancelPayout(
        { userId: admin.id },
        id,
        dto.reason ?? null,
      ),
    );
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @ApiOperation({
    summary: '«Назначить трейдера» on a pay-out',
    description:
      'A pool pay-out, or a canceled one (revived: the merchant is held again, a new window). The take’s checks all apply (403 PAYOUTS_ACCESS_DISABLED · TRADING_DISABLED · INSURANCE_BELOW_MINIMUM; 409 TRADER_NOT_ADMITTED · RATE_NOT_FOUND · ALREADY_TAKEN · PAYOUT_ACTIVE_LIMIT · PAYOUT_INSURANCE_LIMIT · OVERDRAFT_NOT_CONFIRMED). Not an active trader: 400.',
  })
  @ApiEnvelopeResponse(TransactionDto)
  async assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignPayoutTraderDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<TransactionDto> {
    if (admin.id === dto.traderUserId) {
      throw new ForbiddenException('Cannot act on your own transaction');
    }
    await this.assertMayActOn(admin, id);

    return toTransactionDto(
      await this.payoutActions.assignByAdmin({ userId: admin.id }, id, {
        traderUserId: dto.traderUserId,
        confirmOverdraft: dto.confirmOverdraft ?? false,
      }),
    );
  }

  @Post(':id/dispute')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        amountFiat: { type: 'string', example: '5000.00' },
      },
    },
  })
  @ApiOperation({
    summary: '«Открыть спор» by an admin',
    description:
      'Any status and age; an open pay-in gets a deferred dispute, like the merchant’s. The receipt is required (PDF or an image, at most DISPUTE_FILE_MAX_BYTES). 409 DISPUTE_NOT_ALLOWED (in dispute already, or a canceled pay-out), NO_TRADER_TO_DISPUTE.',
  })
  @ApiEnvelopeResponse(TransactionDto)
  async openDispute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OpenAdminDisputeDto,
    @CurrentUser() admin: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<TransactionDto> {
    if (!file) throw new BadRequestException('The receipt file is required');
    await this.assertMayActOn(admin, id);

    return toTransactionDto(
      await this.disputes.openByAdmin(
        { userId: admin.id },
        id,
        { buffer: file.buffer, name: file.originalname },
        dto.amountFiat === undefined ? null : toFiat(dto.amountFiat),
      ),
    );
  }

  @Post(':id/callback')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @ApiOperation({
    summary: '«Отправить callback»: the deal’s current state to the merchant',
    description:
      'A new callback, signed and retried like any other. 409 NO_CALLBACK_URL, CALLBACK_QUEUED; 429 within a minute of the last.',
  })
  @ApiEnvelopeResponse(MerchantCallbackDto)
  async sendCallback(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<MerchantCallbackDto> {
    await this.assertMayActOn(admin, id);

    return toMerchantCallbackDto(
      await this.dealActions.sendCallback({ userId: admin.id }, id),
    );
  }

  private async assertMayActOn(
    admin: AuthenticatedUser,
    transactionId: string,
  ): Promise<void> {
    const transaction = await this.transactions.findById(transactionId);

    if (!transaction) throw new NotFoundException('Transaction not found');

    if (admin.id === transaction.traderUserId) {
      throw new ForbiddenException('Cannot act on your own transaction');
    }

    const trader = transaction.traderUserId
      ? await this.directory.findById(transaction.traderUserId)
      : null;

    if (trader && !canIssueRole(admin.role, trader.role)) {
      throw new ForbiddenException(`Cannot act on a ${trader.role}`);
    }
  }

  private async filterOf(
    query: TransactionFilterDto,
  ): Promise<TransactionFilter> {
    const timeZone = this.config.getOrThrow<string>('BUSINESS_TIMEZONE');
    const ranged =
      query.period !== undefined ||
      query.createdFrom !== undefined ||
      query.createdTo !== undefined;
    const [groupIds, counterpartyIds, bankIds, requisiteIds] =
      await Promise.all([
        query.merchantGroupId === undefined
          ? undefined
          : this.merchants.findIdsOfGroup(query.merchantGroupId),
        query.counterparty === undefined
          ? undefined
          : this.counterparties.findIdsByReference(query.counterparty),
        query.bankId === undefined
          ? undefined
          : this.bankDetails.findIdsOfBank(query.bankId),
        query.requisite === undefined
          ? undefined
          : this.bankDetails.findIdsMatching(query.requisite, true),
      ]);
    const merchantIds =
      groupIds && query.merchantId !== undefined
        ? groupIds.filter((id) => id === query.merchantId)
        : groupIds;

    return {
      ...(ranged ? createdRange(query, timeZone) : {}),
      kind: query.kind,
      statuses: query.status,
      method: query.method,
      traderUserId: query.traderUserId,
      merchantId: query.merchantId,
      merchantIds,
      counterpartyIds,
      bankDetailsIds: bankIds,
      amountFrom:
        query.amountFrom === undefined ? undefined : toFiat(query.amountFrom),
      amountTo:
        query.amountTo === undefined ? undefined : toFiat(query.amountTo),
      search: query.search,
      requisite:
        query.requisite === undefined
          ? undefined
          : { bankDetailsIds: requisiteIds ?? [], text: query.requisite },
    };
  }

  private async cardDto(
    card: TransactionCard,
  ): Promise<AdminTransactionCardDto> {
    const { deal } = card;
    const actorIds = distinct([
      ...card.events.map((event) => event.actorUserId),
      ...card.disputes.map((dispute) => dispute.resolvedByUserId),
      ...card.leadShares.map((share) => share.leadUserId),
    ]);
    const [[row], people] = await Promise.all([
      this.withDetails([deal]),
      this.directory.findByIds(actorIds),
    ]);
    const personById = new Map(people.map((user) => [user.id, user]));
    const actorOf = (userId: string | null) => {
      const user = userId ? personById.get(userId) : undefined;

      return user
        ? { id: user.id, login: loginOf(user), role: user.role }
        : null;
    };
    const history: CardHistoryEntryDto[] = [
      ...card.events.map((event) => ({
        kind: CardHistoryKind.Status,
        at: event.createdAt,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        source: event.source,
        actor: actorOf(event.actorUserId),
        reason: event.reason,
        disputeId: null,
        disputeStatus: null,
      })),
      ...card.disputes.flatMap((dispute) => [
        {
          kind: CardHistoryKind.DisputeOpened,
          at: dispute.openedAt,
          fromStatus: dispute.statusBefore,
          toStatus: null,
          source: null,
          actor: null,
          reason: null,
          disputeId: dispute.id,
          disputeStatus: dispute.status,
        },
        ...(dispute.resolvedAt
          ? [
              {
                kind: CardHistoryKind.DisputeResolved,
                at: dispute.resolvedAt,
                fromStatus: null,
                toStatus: null,
                source: null,
                actor: actorOf(dispute.resolvedByUserId),
                reason: dispute.declineReason,
                disputeId: dispute.id,
                disputeStatus: dispute.status,
              },
            ]
          : []),
      ]),
    ].sort((left, right) => right.at.getTime() - left.at.getTime());

    return {
      ...row,
      payerUserId: deal.payerInfo?.userId ?? null,
      originalAmountFiat: deal.originalAmountFiat
        ? formatFiat(deal.originalAmountFiat)
        : null,
      originalAmountCrypto: deal.originalAmountCrypto
        ? formatCrypto(deal.originalAmountCrypto)
        : null,
      leadShares: card.leadShares.map((share) => {
        const lead = personById.get(share.leadUserId);

        return {
          leadUserId: share.leadUserId,
          login: lead ? loginOf(lead) : null,
          percent: share.percent,
          amount: formatCrypto(share.amount),
        };
      }),
      files: card.files.map(toFileDto),
      history,
      actions: card.actions,
    };
  }

  private async withDetails(
    rows: Transaction[],
  ): Promise<TransactionListItemDto[]> {
    const [traders, merchants, requisites, counterparties, banks] =
      await Promise.all([
        this.directory.findByIds(distinct(rows.map((row) => row.traderUserId))),
        this.merchants.findByIds(distinct(rows.map((row) => row.merchantId))),
        this.bankDetails.findByIdsWithDeleted(
          distinct(rows.map((row) => row.bankDetailsId)),
        ),
        this.counterparties.findByIds(
          distinct(rows.map((row) => row.counterpartyId)),
        ),
        this.banks.findByIds(distinct(rows.map((row) => row.payoutBankId))),
      ]);
    const traderById = new Map(traders.map((user) => [user.id, user]));
    const merchantById = new Map(merchants.map((row) => [row.id, row]));
    const requisiteById = new Map(requisites.map((row) => [row.id, row]));
    const counterpartyById = new Map(
      counterparties.map((row) => [row.id, row]),
    );
    const bankById = new Map(banks.map((bank) => [bank.id, bank]));

    return rows.map((row) => {
      const trader = traderById.get(row.traderUserId);
      const merchant = merchantById.get(row.merchantId);
      const requisite = requisiteById.get(row.bankDetailsId);
      const counterparty = counterpartyById.get(row.counterpartyId);
      const payoutBank = row.payoutBankId
        ? bankById.get(row.payoutBankId)
        : undefined;

      return toTransactionListItemDto(row, {
        trader: trader
          ? {
              id: trader.id,
              login: loginOf(trader),
              telegramUsername: trader.telegramUsername ?? null,
              telegramGroups: trader.telegramGroups ?? null,
            }
          : null,
        merchant: merchant ? { id: merchant.id, name: merchant.name } : null,
        bankDetails: requisite
          ? {
              id: requisite.id,
              type: requisite.type,
              card: requisite.card ?? null,
              phone: requisite.phone ?? null,
              cardholderName: requisite.cardholderName ?? null,
              bank: requisite.bank
                ? { id: requisite.bank.id, name: requisite.bank.name }
                : null,
              mobileOperator: requisite.mobileOperator
                ? {
                    id: requisite.mobileOperator.id,
                    name: requisite.mobileOperator.name,
                  }
                : null,
            }
          : null,
        counterparty: counterparty
          ? { id: counterparty.id, name: counterparty.name ?? null }
          : null,
        recipient:
          row.kind === 'pay_out'
            ? {
                ownerName: row.payoutOwnerName ?? null,
                bank: payoutBank
                  ? { id: payoutBank.id, name: payoutBank.name }
                  : null,
                cardNumber: row.payoutCardNumber ?? null,
                phone: row.payoutPhone ?? null,
              }
            : null,
      });
    });
  }
}
