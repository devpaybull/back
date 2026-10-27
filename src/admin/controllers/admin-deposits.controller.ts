import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
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
import { AccountTransaction } from '../../account-transactions/entities/account-transaction.entity';
import { AccountTransactionsService } from '../../account-transactions/services/account-transactions.service';
import { DepositsService } from '../../account-transactions/services/deposits.service';
import { AccountTransactionType } from '../../account-transactions/types/account-transaction-type.enum';
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
import { loginOf } from '../../common/utils/login-of';
import { roundCrypto } from '../../common/utils/round-crypto';
import { toDecimal } from '../../common/utils/to-decimal';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { DepositStatsDto } from '../dto/account-transaction-stats.dto';
import { AdminDepositDto, toAdminDepositDto } from '../dto/admin-deposit.dto';
import { ListAccountTransactionsQueryDto } from '../dto/list-account-transactions-query.dto';
import { TxHashDto } from '../dto/tx-hash.dto';
import { HashCreditPlanDto } from '../dto/hash-credit-plan.dto';
import { HashVerificationDto } from '../dto/usdt-transfer-inspection.dto';
import { accountTransactionsCsv } from '../utils/account-transactions-csv';
import { ACCOUNT_TRANSACTIONS_EXPORT_MAX_ROWS } from '../utils/account-transactions-export-max-rows';
import { assertMayActOnAccount } from '../utils/assert-may-act-on-account';
import { toAccountTransactionParties } from '../utils/to-account-transaction-parties';
import { toAccountTransactionListQuery } from '../utils/to-account-transaction-list-query';
import { toHashVerificationDto } from '../utils/to-hash-verification-dto';

@ApiTags('Admin · Deposits')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/deposits')
export class AdminDepositsController {
  constructor(
    private readonly config: ConfigService,
    private readonly operations: AccountTransactionsService,
    private readonly deposits: DepositsService,
    private readonly directory: UserDirectoryService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lists deposits; tabs are status filters' })
  @ApiPagedResponse(AdminDepositDto)
  async list(
    @Query() query: ListAccountTransactionsQueryDto,
  ): Promise<Page<AdminDepositDto>> {
    const page = await this.operations.list(
      await toAccountTransactionListQuery(
        AccountTransactionType.Deposit,
        query,
        this.directory,
        this.operations,
        this.config.getOrThrow<string>('BUSINESS_TIMEZONE'),
      ),
    );
    const details = await this.detailsOf(page.items);

    return page.map(details);
  }

  @Get('stats')
  @ApiOperation({ summary: 'The KPI cards and the tab counters' })
  @ApiEnvelopeResponse(DepositStatsDto)
  async stats(): Promise<DepositStatsDto> {
    const stats = await this.operations.stats(
      AccountTransactionType.Deposit,
      new Date(),
      this.config.get<number>('PAYOUT_STALE_MINUTES', 30),
    );
    const { byStatus } = stats;
    const finished = stats.finishedLast24h;

    return {
      total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
      inProgress: byStatus.pending + byStatus.processing,
      processing: byStatus.processing,
      belowMinimum: stats.belowMinimum,
      problem: byStatus.failed,
      completedLast24h: {
        count: stats.completedLast24h.count,
        amount: formatCrypto(stats.completedLast24h.amount),
      },
      successRate:
        finished === 0
          ? 0
          : Math.round((stats.completedLast24h.count / finished) * 100),
      byStatus,
    };
  }

  @Get('export')
  @ApiOperation({ summary: 'The same filters as a CSV file' })
  @ApiOkResponse({
    description: 'text/csv attachment, not wrapped in the response envelope',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  async export(
    @Query() query: ListAccountTransactionsQueryDto,
  ): Promise<StreamableFile> {
    const rows = await this.operations.exportRows(
      await toAccountTransactionListQuery(
        AccountTransactionType.Deposit,
        query,
        this.directory,
        this.operations,
        this.config.getOrThrow<string>('BUSINESS_TIMEZONE'),
      ),
      ACCOUNT_TRANSACTIONS_EXPORT_MAX_ROWS,
    );

    if (rows.length > ACCOUNT_TRANSACTIONS_EXPORT_MAX_ROWS) {
      throw new BadRequestException(
        'Too many rows to export; narrow the period or the filters',
      );
    }

    const users = await this.directory.findByIds([
      ...new Set(rows.map((row) => row.userId)),
    ]);
    const logins = new Map(users.map((user) => [user.id, loginOf(user)]));
    const csv = accountTransactionsCsv(
      rows.map((row) => {
        const amount = row.creditedAmount ?? row.amount;

        return {
          id: row.id,
          status: row.status,
          statusReason: row.statusReason,
          login: logins.get(row.userId) ?? null,
          address: row.address,
          amount: amount === null ? null : formatCrypto(amount),
          fee: null,
          txHash: row.txHash,
          createdAt: row.createdAt,
          completedAt: row.completedAt,
        };
      }),
    );

    return new StreamableFile(Buffer.from(csv, 'utf-8'), {
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="deposits.csv"',
    });
  }

  @Post('verify-by-hash')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Inspects a hash for transfers to any trader’s deposit address, writes nothing',
  })
  @ApiEnvelopeResponse(HashCreditPlanDto)
  async verifyByHash(@Body() dto: TxHashDto): Promise<HashCreditPlanDto> {
    const plan = await this.deposits.planCreditByHash(dto.txHash);
    const parties = toAccountTransactionParties(
      await this.directory.findByIds(plan.candidates.map((c) => c.userId)),
    );

    return {
      ...toHashVerificationDto(
        plan.inspection,
        plan.refusal === null,
        null,
        plan.refusal?.message ?? null,
      ),
      candidates: plan.candidates.map((candidate) => ({
        user: parties.get(candidate.userId) ?? null,
        address: candidate.address,
        amount: formatCrypto(
          roundCrypto(
            candidate.transfers.reduce(
              (sum, transfer) => sum.plus(transfer.amount),
              toDecimal(0),
            ),
          ),
        ),
        alreadyCredited: candidate.alreadyCredited,
      })),
    };
  }

  @Post('credit-by-hash')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @ApiOperation({
    summary:
      'Credits a transfer to a trader’s deposit address that no deposit row holds',
  })
  @ApiEnvelopeResponse(AdminDepositDto, { isArray: true })
  async creditByHash(
    @Body() dto: TxHashDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<AdminDepositDto[]> {
    const plan = await this.deposits.planCreditByHash(dto.txHash);

    if (plan.refusal) throw plan.refusal;

    const owners = await this.directory.findByIds(
      plan.candidates.map((candidate) => candidate.userId),
    );

    for (const owner of owners) assertMayActOnAccount(admin, owner);

    const rows = await this.deposits.creditByHash(dto.txHash, admin.id);
    const details = await this.detailsOf(rows);

    return rows.map(details);
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '«Проверить»: inspects a hash against this deposit, writes nothing',
  })
  @ApiEnvelopeResponse(HashVerificationDto)
  async verify(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TxHashDto,
  ): Promise<HashVerificationDto> {
    const verification = await this.deposits.verifyForCredit(id, dto.txHash);

    return toHashVerificationDto(
      verification.inspection,
      verification.creditable,
      verification.amount,
      verification.reason,
    );
  }

  @Post(':id/credit')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @ApiOperation({
    summary:
      '«Зачислить»: credits the transfer of this hash to the deposit’s owner',
  })
  @ApiEnvelopeResponse(AdminDepositDto)
  async credit(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TxHashDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<AdminDepositDto> {
    const row = await this.deposits.findById(id);

    if (!row) throw new NotFoundException('Deposit not found');

    assertMayActOnAccount(admin, await this.directory.findById(row.userId));
    const credited = await this.deposits.creditManually(
      id,
      dto.txHash,
      admin.id,
    );

    return (await this.detailsOf([credited]))(credited);
  }

  private async detailsOf(
    rows: AccountTransaction[],
  ): Promise<(row: AccountTransaction) => AdminDepositDto> {
    const [transfers, users] = await Promise.all([
      this.operations.transfersOf(rows.map((row) => row.id)),
      this.directory.findByIds([
        ...new Set(
          rows.flatMap((row) =>
            row.actorUserId ? [row.userId, row.actorUserId] : [row.userId],
          ),
        ),
      ]),
    ]);
    const parties = toAccountTransactionParties(users);
    const window = this.config.getOrThrow<number>('DEPOSIT_WINDOW_MINUTES');

    return (row) =>
      toAdminDepositDto(row, transfers.get(row.id) ?? [], parties, window);
  }
}
