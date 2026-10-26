import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
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
import { toCrypto } from '../../common/utils/to-crypto';
import { CreateWithdrawalDto } from '../dto/create-withdrawal.dto';
import {
  FinanceOperationDto,
  toFinanceOperationDto,
} from '../dto/finance-operation.dto';
import { WithdrawalQuoteQueryDto } from '../dto/withdrawal-quote-query.dto';
import {
  toWithdrawalQuoteDto,
  WithdrawalQuoteDto,
} from '../dto/withdrawal-quote.dto';
import { WithdrawalsService } from '../services/withdrawals.service';

@ApiTags('Finances')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Trader, Role.LeadTrader)
@Controller('users/me/withdrawals')
export class WithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalsService) {}

  @Get('quote')
  @WriteAccess()
  @ApiOperation({
    summary: 'Quotes the network fee and the maximum for a withdrawal',
  })
  @ApiEnvelopeResponse(WithdrawalQuoteDto)
  async quote(
    @Query() query: WithdrawalQuoteQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WithdrawalQuoteDto> {
    return toWithdrawalQuoteDto(
      await this.withdrawals.quote(
        user.id,
        query.address,
        toCrypto(query.amount),
      ),
    );
  }

  @Post()
  @WriteAccess()
  @ApiOperation({
    summary:
      'Requests a withdrawal (TOTP only); the quoted fee is withheld on top of the amount',
  })
  @ApiEnvelopeResponse(FinanceOperationDto, { status: HttpStatus.CREATED })
  async create(
    @Body() dto: CreateWithdrawalDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FinanceOperationDto> {
    const row = await this.withdrawals.request({
      userId: user.id,
      address: dto.address,
      amount: toCrypto(dto.amount),
      totp: dto.totp,
    });

    return toFinanceOperationDto(row, user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of the trader’s own withdrawals' })
  @ApiEnvelopeResponse(FinanceOperationDto)
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FinanceOperationDto> {
    return toFinanceOperationDto(
      await this.withdrawals.findOwn(id, user.id),
      user.id,
    );
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @ApiOperation({ summary: 'Cancels a withdrawal still waiting in the queue' })
  @ApiEnvelopeResponse(FinanceOperationDto)
  async cancel(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FinanceOperationDto> {
    return toFinanceOperationDto(
      await this.withdrawals.cancelOwn(id, user.id),
      user.id,
    );
  }
}
