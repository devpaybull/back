import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WriteAccess } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { DebtsService } from '../../debts/services/debts.service';
import { BalanceOperation } from '../../transactions/entities/balance-operation.entity';
import { TransactionService } from '../../transactions/services/transaction.service';
import { WalletService } from '../../transactions/services/wallet.service';
import { BalanceOperationType } from '../../transactions/types/balance-operation-type.enum';
import { StatusEventSource } from '../../transactions/types/status-event-source.enum';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { BalanceOperationFilterDto } from '../dto/balance-operation-filter.dto';
import {
  BalanceOperationDto,
  toBalanceOperationDto,
} from '../dto/balance-operation.dto';
import { ListBalanceOperationsQueryDto } from '../dto/list-balance-operations-query.dto';
import { balanceOperationsCsv } from '../utils/balance-operations-csv';
import { AdminTransferDto } from '../dto/admin-transfer.dto';
import { BalancesDto, toBalancesDto } from '../dto/balances.dto';
import { toTransactionDto, TransactionDto } from '../dto/transaction.dto';
import { canIssueRole } from '../utils/can-issue-role';

export const BALANCE_EXPORT_MAX_ROWS = 100000;

const TRANSFER_RECIPIENT_ROLES: Role[] = [Role.Trader, Role.LeadTrader];

@ApiTags('Admin · Balances')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/users/:id')
export class AdminBalancesController {
  constructor(
    private readonly wallets: WalletService,
    private readonly transactions: TransactionService,
    private readonly directory: UserDirectoryService,
    private readonly debts: DebtsService,
  ) {}

  @Get('balances')
  @ApiOperation({ summary: 'Reads an account’s wallet balances' })
  @ApiEnvelopeResponse(BalancesDto)
  async balances(@Param('id', ParseUUIDPipe) id: string): Promise<BalancesDto> {
    const user = await this.directory.findById(id);

    if (!user) throw new NotFoundException('User not found');

    const wallet = await this.wallets.findByUserId(id);

    if (!wallet) throw new NotFoundException('Wallet not found');

    return toBalancesDto(wallet);
  }

  @Get('balance-operations')
  @ApiOperation({
    summary: 'Lists an account’s balance journal, newest first',
    description:
      'Filters: from (inclusive) and to (exclusive) on createdAt, type (one or several), kind. An account with no wallet gets an empty page.',
  })
  @ApiPagedResponse(BalanceOperationDto)
  async balanceOperations(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListBalanceOperationsQueryDto,
  ): Promise<Page<BalanceOperationDto>> {
    await this.requireUser(id);

    const page = await this.wallets.listOperations({
      userId: id,
      from: query.from,
      to: query.to,
      types: query.type,
      kind: query.kind,
      page: query.page,
      limit: query.limit,
      sortOrder: query.sortOrder,
    });
    const debtIds = await this.debtIdsOf(page.items);

    return page.map((operation) =>
      toBalanceOperationDto(operation, debtIds.get(operation.id) ?? null),
    );
  }

  @Get('balance-operations/export')
  @ApiOperation({
    summary: 'Exports an account’s balance journal as CSV',
    description: `Same filters as the list, no pagination, newest first. Comma-separated, UTF-8, CRLF line endings, header row. More than ${BALANCE_EXPORT_MAX_ROWS} matching rows is a 400: narrow the period.`,
  })
  @ApiOkResponse({
    description: 'text/csv attachment, not wrapped in the response envelope',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  async exportBalanceOperations(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: BalanceOperationFilterDto,
  ): Promise<StreamableFile> {
    await this.requireUser(id);

    const operations = await this.wallets.exportOperations(
      {
        userId: id,
        from: query.from,
        to: query.to,
        types: query.type,
        kind: query.kind,
      },
      BALANCE_EXPORT_MAX_ROWS,
    );
    const debtIds = await this.debtIdsOf(operations);
    const csv = balanceOperationsCsv(
      operations.map((operation) =>
        toBalanceOperationDto(operation, debtIds.get(operation.id) ?? null),
      ),
    );

    return new StreamableFile(Buffer.from(csv, 'utf-8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="balance-operations-${id}.csv"`,
    });
  }

  @Post('transfer')
  @WriteAccess()
  @ApiOperation({ summary: 'Transfers USDT from this account to another' })
  @ApiEnvelopeResponse(TransactionDto, { status: HttpStatus.CREATED })
  async transfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminTransferDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<TransactionDto> {
    if (admin.id === id) {
      throw new ForbiddenException('Cannot transfer from your own account');
    }

    const sender = await this.directory.findById(id);

    if (!sender) throw new NotFoundException('User not found');

    if (!canIssueRole(admin.role, sender.role)) {
      throw new ForbiddenException(`Cannot act on a ${sender.role}`);
    }

    const recipient = await this.directory.findByLogin(dto.recipient);

    if (!recipient) throw new NotFoundException('Recipient not found');

    if (!TRANSFER_RECIPIENT_ROLES.includes(recipient.role)) {
      throw new BadRequestException(
        'Recipient must be a trader or lead trader',
      );
    }

    const transaction = await this.transactions.createInternalTransfer({
      fromUserId: id,
      toUserId: recipient.id,
      amount: dto.amount,
      source: StatusEventSource.Admin,
      actorUserId: admin.id,
      comment: dto.comment,
    });

    return toTransactionDto(transaction);
  }

  private async requireUser(id: string): Promise<void> {
    if (!(await this.directory.findById(id))) {
      throw new NotFoundException('User not found');
    }
  }

  private debtIdsOf(
    operations: BalanceOperation[],
  ): Promise<Map<number, number>> {
    return this.debts.debtIdsByBalanceOperation(
      operations
        .filter(
          (operation) =>
            operation.type === BalanceOperationType.DebtIssued ||
            operation.type === BalanceOperationType.DebtWriteOff,
        )
        .map((operation) => operation.id),
    );
  }
}
