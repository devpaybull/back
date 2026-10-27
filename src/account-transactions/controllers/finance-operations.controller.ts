import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Page } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { toInstant } from '../../common/utils/to-instant';
import { FinanceHistoryFilterDto } from '../dto/finance-history-filter.dto';
import { FinanceOperationCountsDto } from '../dto/finance-operation-counts.dto';
import {
  FinanceOperationDto,
  toFinanceOperationDto,
} from '../dto/finance-operation.dto';
import { ListFinanceOperationsQueryDto } from '../dto/list-finance-operations-query.dto';
import { AccountTransactionsService } from '../services/account-transactions.service';

@ApiTags('Finances')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.Trader, Role.LeadTrader)
@Controller('users/me/finance-operations')
export class FinanceOperationsController {
  constructor(
    private readonly operations: AccountTransactionsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'The trader’s deposits, withdrawals and transfers' })
  @ApiPagedResponse(FinanceOperationDto)
  async list(
    @Query() query: ListFinanceOperationsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Page<FinanceOperationDto>> {
    return (
      await this.operations.history({
        userId: user.id,
        page: query.page,
        limit: query.limit,
        sortOrder: query.sortOrder,
        sortBy: query.sortBy,
        type: query.type,
        status: query.status,
        from: toInstant(query.from, this.timeZone()),
        to: toInstant(query.to, this.timeZone()),
      })
    ).map((row) => toFinanceOperationDto(row, user.id));
  }

  @Get('stats')
  @ApiOperation({ summary: 'Counts for the tabs, under the same filters' })
  @ApiEnvelopeResponse(FinanceOperationCountsDto)
  async stats(
    @Query() query: FinanceHistoryFilterDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FinanceOperationCountsDto> {
    const counts = await this.operations.historyCounts({
      userId: user.id,
      status: query.status,
      from: toInstant(query.from, this.timeZone()),
      to: toInstant(query.to, this.timeZone()),
    });

    return {
      all: counts.deposit + counts.withdrawal + counts.transfer,
      ...counts,
    };
  }

  private timeZone(): string {
    return this.config.getOrThrow<string>('BUSINESS_TIMEZONE');
  }
}
