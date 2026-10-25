import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { toFiat } from '../../common/utils/to-fiat';
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
import { BankDetailsService } from '../../bank-details/bank-details.service';
import { loginOf } from '../../common/utils/login-of';
import { CounterpartiesService } from '../../counterparties/counterparties.service';
import { MerchantsService } from '../../merchants/merchants.service';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { TransactionService } from '../../transactions/services/transaction.service';
import { TransactionSortField } from '../../transactions/types/transaction-sort-field.enum';
import { StatusEventSource } from '../../transactions/types/status-event-source.enum';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { ChangeTransactionStatusDto } from '../dto/change-transaction-status.dto';
import { ListTransactionsQueryDto } from '../dto/list-transactions-query.dto';
import { toTransactionDto, TransactionDto } from '../dto/transaction.dto';
import {
  toTransactionListItemDto,
  TransactionListItemDto,
} from '../dto/transaction-list-item.dto';
import { canIssueRole } from '../utils/can-issue-role';

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
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lists transactions across every account' })
  @ApiPagedResponse(TransactionListItemDto)
  async list(
    @Query() query: ListTransactionsQueryDto,
  ): Promise<Page<TransactionListItemDto>> {
    const [bankDetailsIds, merchantRanks] = await Promise.all([
      query.bankId !== undefined
        ? this.bankDetails.findIdsOfBank(query.bankId)
        : undefined,
      query.sortBy === TransactionSortField.Merchant
        ? this.merchants.rankByName()
        : undefined,
    ]);
    const page = await this.transactions.list({
      ...query,
      amountFrom:
        query.amountFrom === undefined ? undefined : toFiat(query.amountFrom),
      amountTo:
        query.amountTo === undefined ? undefined : toFiat(query.amountTo),
      bankDetailsIds,
      merchantRanks,
    });

    return new Page(await this.withDetails(page.items), page.meta);
  }

  private async withDetails(
    rows: Transaction[],
  ): Promise<TransactionListItemDto[]> {
    const distinct = <T>(values: (T | null | undefined)[]): T[] => [
      ...new Set(
        values.filter(
          (value): value is T => value !== null && value !== undefined,
        ),
      ),
    ];

    const [traders, merchants, requisites, counterparties] = await Promise.all([
      this.directory.findByIds(distinct(rows.map((row) => row.traderUserId))),
      this.merchants.findByIds(distinct(rows.map((row) => row.merchantId))),
      this.bankDetails.findByIdsWithDeleted(
        distinct(rows.map((row) => row.bankDetailsId)),
      ),
      this.counterparties.findByIds(
        distinct(rows.map((row) => row.counterpartyId)),
      ),
    ]);
    const traderById = new Map(traders.map((user) => [user.id, user]));
    const merchantById = new Map(merchants.map((row) => [row.id, row]));
    const requisiteById = new Map(requisites.map((row) => [row.id, row]));
    const counterpartyById = new Map(
      counterparties.map((row) => [row.id, row]),
    );

    return rows.map((row) => {
      const trader = traderById.get(row.traderUserId);
      const merchant = merchantById.get(row.merchantId);
      const requisite = requisiteById.get(row.bankDetailsId);
      const counterparty = counterpartyById.get(row.counterpartyId);

      return toTransactionListItemDto(row, {
        trader: trader
          ? {
              id: trader.id,
              login: loginOf(trader),
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
              bank: { id: requisite.bank.id, name: requisite.bank.name },
            }
          : null,
        counterparty: counterparty
          ? { id: counterparty.id, name: counterparty.name ?? null }
          : null,
      });
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Reads one transaction' })
  @ApiEnvelopeResponse(TransactionDto)
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TransactionDto> {
    const found = await this.transactions.findById(id);

    if (!found) throw new NotFoundException('Transaction not found');

    return toTransactionDto(found);
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
    const transaction = await this.transactions.findById(id);

    if (!transaction) throw new NotFoundException('Transaction not found');

    if (admin.id === transaction.traderUserId) {
      throw new ForbiddenException('Cannot act on your own transaction');
    }

    const trader = await this.directory.findById(transaction.traderUserId);

    if (trader && !canIssueRole(admin.role, trader.role)) {
      throw new ForbiddenException(`Cannot act on a ${trader.role}`);
    }

    const updated = await this.transactions.transition(id, {
      toStatus: dto.status,
      source: StatusEventSource.Admin,
      actorUserId: admin.id,
      reason: dto.reason,
    });

    return toTransactionDto(updated);
  }
}
