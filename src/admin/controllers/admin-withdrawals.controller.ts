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
import { WithdrawalsService } from '../../account-transactions/services/withdrawals.service';
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
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { WithdrawalStatsDto } from '../dto/account-transaction-stats.dto';
import {
  AdminWithdrawalDto,
  toAdminWithdrawalDto,
} from '../dto/admin-withdrawal.dto';
import { ListAccountTransactionsQueryDto } from '../dto/list-account-transactions-query.dto';
import { RejectWithdrawalDto } from '../dto/reject-withdrawal.dto';
import { TxHashDto } from '../dto/tx-hash.dto';
import { HashVerificationDto } from '../dto/usdt-transfer-inspection.dto';
import { accountTransactionsCsv } from '../utils/account-transactions-csv';
import { ACCOUNT_TRANSACTIONS_EXPORT_MAX_ROWS } from '../utils/account-transactions-export-max-rows';
import { assertMayActOnAccount } from '../utils/assert-may-act-on-account';
import { toAccountTransactionListQuery } from '../utils/to-account-transaction-list-query';
import { toAccountTransactionParties } from '../utils/to-account-transaction-parties';
import { toHashVerificationDto } from '../utils/to-hash-verification-dto';

@ApiTags('Admin · Withdrawals')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/withdrawals')
export class AdminWithdrawalsController {
  constructor(
    private readonly config: ConfigService,
    private readonly operations: AccountTransactionsService,
    private readonly withdrawals: WithdrawalsService,
    private readonly directory: UserDirectoryService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lists withdrawals; tabs are status filters' })
  @ApiPagedResponse(AdminWithdrawalDto)
  async list(
    @Query() query: ListAccountTransactionsQueryDto,
  ): Promise<Page<AdminWithdrawalDto>> {
    const page = await this.operations.list(
      await toAccountTransactionListQuery(
        AccountTransactionType.Withdrawal,
        query,
        this.directory,
        this.operations,
        this.config.getOrThrow<string>('BUSINESS_TIMEZONE'),
      ),
    );

    return page.map(await this.detailsOf(page.items));
  }

  @Get('stats')
  @ApiOperation({ summary: 'The KPI cards and the tab counters' })
  @ApiEnvelopeResponse(WithdrawalStatsDto)
  async stats(): Promise<WithdrawalStatsDto> {
    const stats = await this.operations.stats(
      AccountTransactionType.Withdrawal,
      new Date(),
      this.config.get<number>('PAYOUT_STALE_MINUTES', 30),
    );
    const { byStatus } = stats;
    const finished = stats.finishedLast24h;

    return {
      queued: byStatus.pending,
      active: byStatus.processing,
      stale: stats.staleProcessing,
      manualReview: 0,
      failed: byStatus.failed,
      paidLast24h: {
        count: stats.completedLast24h.count,
        amount: formatCrypto(stats.completedLast24h.amount),
      },
      successRate:
        finished === 0
          ? 0
          : Math.round((stats.completedLast24h.count / finished) * 100),
      mode: this.config.get<string>('PAYOUT_MODE', 'manual'),
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
        AccountTransactionType.Withdrawal,
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
      rows.map((row) => ({
        id: row.id,
        status: row.status,
        statusReason: row.statusReason,
        login: logins.get(row.userId) ?? null,
        address: row.address,
        amount: row.amount === null ? null : formatCrypto(row.amount),
        fee: row.fee === null ? null : formatCrypto(row.fee),
        txHash: row.txHash,
        createdAt: row.createdAt,
        completedAt: row.completedAt,
      })),
    );

    return new StreamableFile(Buffer.from(csv, 'utf-8'), {
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="withdrawals.csv"',
    });
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '«Проверить»: inspects a payment hash against this withdrawal, writes nothing',
  })
  @ApiEnvelopeResponse(HashVerificationDto)
  async verify(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TxHashDto,
  ): Promise<HashVerificationDto> {
    const verification = await this.withdrawals.verifyPayment(id, dto.txHash);

    return toHashVerificationDto(
      verification.inspection,
      verification.completable,
      verification.amountSent,
      verification.reason,
    );
  }

  @Post(':id/complete-manually')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @ApiOperation({
    summary: '«Вывести»: closes a withdrawal the admin paid outside the system',
  })
  @ApiEnvelopeResponse(AdminWithdrawalDto)
  async completeManually(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TxHashDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<AdminWithdrawalDto> {
    await this.requireActable(id, admin);
    const row = await this.withdrawals.completeManually(
      id,
      dto.txHash,
      admin.id,
    );

    return (await this.detailsOf([row]))(row);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @ApiOperation({
    summary: 'Rejects a pending or failed withdrawal and releases its reserve',
  })
  @ApiEnvelopeResponse(AdminWithdrawalDto)
  async reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectWithdrawalDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<AdminWithdrawalDto> {
    await this.requireActable(id, admin);
    const row = await this.withdrawals.reject(id, admin.id, dto.reason);

    return (await this.detailsOf([row]))(row);
  }

  private async requireActable(
    id: number,
    admin: AuthenticatedUser,
  ): Promise<void> {
    const row = await this.withdrawals.findById(id);

    if (!row) throw new NotFoundException('Withdrawal not found');

    assertMayActOnAccount(admin, await this.directory.findById(row.userId));
  }

  private async detailsOf(
    rows: AccountTransaction[],
  ): Promise<(row: AccountTransaction) => AdminWithdrawalDto> {
    const [attempts, users] = await Promise.all([
      this.operations.attemptsOf(rows.map((row) => row.id)),
      this.directory.findByIds([
        ...new Set(
          rows.flatMap((row) =>
            row.actorUserId ? [row.userId, row.actorUserId] : [row.userId],
          ),
        ),
      ]),
    ]);
    const parties = toAccountTransactionParties(users);

    const payableByHand = this.withdrawals.payableByHand();

    return (row) =>
      toAdminWithdrawalDto(
        row,
        attempts.get(row.id) ?? [],
        parties,
        payableByHand,
      );
  }
}
