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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WriteAccess } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { AuthenticatedUser } from '../../common/types/token';
import { TransactionService } from '../../transactions/services/transaction.service';
import { WalletService } from '../../transactions/services/wallet.service';
import { StatusEventSource } from '../../transactions/types/status-event-source.enum';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { AdminTransferDto } from '../dto/admin-transfer.dto';
import { BalancesDto, toBalancesDto } from '../dto/balances.dto';
import { toTransactionDto, TransactionDto } from '../dto/transaction.dto';
import { canIssueRole } from '../utils/can-issue-role';

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
}
