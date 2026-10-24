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
import { TransactionService } from '../../transactions/services/transaction.service';
import { StatusEventSource } from '../../transactions/types/status-event-source.enum';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { ChangeTransactionStatusDto } from '../dto/change-transaction-status.dto';
import { ListTransactionsQueryDto } from '../dto/list-transactions-query.dto';
import { toTransactionDto, TransactionDto } from '../dto/transaction.dto';
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
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lists transactions across every account' })
  @ApiPagedResponse(TransactionDto)
  async list(
    @Query() query: ListTransactionsQueryDto,
  ): Promise<Page<TransactionDto>> {
    return (await this.transactions.list(query)).map(toTransactionDto);
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
