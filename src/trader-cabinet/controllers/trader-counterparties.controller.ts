import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BankDetailsService } from '../../bank-details/bank-details.service';
import { BankDetails } from '../../bank-details/entities/bank-details.entity';
import { BankDetailsStatus } from '../../bank-details/types/bank-details-status.enum';
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
import { averageCheckOf } from '../../common/utils/average-check-of';
import { formatFiat } from '../../common/utils/format-fiat';
import { INT4_MAX } from '../../common/utils/int4-max';
import { percentOf } from '../../common/utils/percent-of';
import { roundFiat } from '../../common/utils/round-fiat';
import { toDecimal } from '../../common/utils/to-decimal';
import { CounterpartiesService } from '../../counterparties/services/counterparties.service';
import { CounterpartyDealStatsService } from '../../transactions/services/counterparty-deal-stats.service';
import { ListTraderCounterpartiesQueryDto } from '../dto/list-trader-counterparties-query.dto';
import { ListTraderCounterpartyGroupsQueryDto } from '../dto/list-trader-counterparty-groups-query.dto';
import { MoveCounterpartyDto } from '../dto/move-counterparty.dto';
import { TraderCounterpartyBindingDto } from '../dto/trader-counterparty-binding.dto';
import {
  TraderCounterpartyGroupDto,
  TraderCounterpartyRequisiteDto,
} from '../dto/trader-counterparty-group.dto';
import { TraderCounterpartySummaryQueryDto } from '../dto/trader-counterparty-summary-query.dto';
import { TraderCounterpartySummaryDto } from '../dto/trader-counterparty-summary.dto';
import { TraderCounterpartyDto } from '../dto/trader-counterparty.dto';
import { TraderCounterpartyStatus } from '../types/trader-counterparty-status.enum';

const SCOPE =
  'Every figure counts only the deals of these clients with this trader; the merchant’s client id and other traders’ deals are never shown.';

const assertIdInRange = (id: number): void => {
  if (id < 1 || id > INT4_MAX) {
    throw new NotFoundException('Counterparty not found');
  }
};

@ApiTags('Trader · Counterparties')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Trader)
@Controller('trader/counterparties')
export class TraderCounterpartiesController {
  constructor(
    private readonly bankDetails: BankDetailsService,
    private readonly counterparties: CounterpartiesService,
    private readonly stats: CounterpartyDealStatsService,
  ) {}

  @Get('summary')
  @ApiOperation({
    summary:
      'The four cards: clients bound to the trader’s requisites, conversion, deposits for 30 days, average check',
    description: SCOPE,
  })
  @ApiEnvelopeResponse(TraderCounterpartySummaryDto)
  async summary(
    @CurrentUser() trader: AuthenticatedUser,
    @Query() query: TraderCounterpartySummaryQueryDto,
  ): Promise<TraderCounterpartySummaryDto> {
    const bound = await this.counterparties.boundTo(
      await this.bankDetails.ownCounterpartyOnlyIds(
        trader.id,
        query.bankDetailsId,
      ),
    );
    const deposits = await this.stats.traderCounterpartyDeposits(
      trader.id,
      bound,
      new Date(),
    );
    const paid = deposits.reduce((sum, row) => sum + row.paidCount, 0);
    const completed = deposits.reduce(
      (sum, row) => sum + row.completedCount,
      0,
    );
    const paidAmount = deposits.reduce(
      (sum, row) => sum.plus(row.paidAmount),
      toDecimal(0),
    );
    const deposits30d = deposits.reduce(
      (sum, row) => sum.plus(row.deposits30d),
      toDecimal(0),
    );

    return {
      total: bound.length,
      averageConversion: percentOf(paid, completed),
      deposits30d: formatFiat(roundFiat(deposits30d)),
      averageCheck: averageCheckOf(paidAmount, paid),
    };
  }

  @Get('groups')
  @ApiOperation({
    summary:
      'The accordion: the trader’s counterparty-only requisites with their slots and deposits for 30 days',
    description: SCOPE,
  })
  @ApiPagedResponse(TraderCounterpartyGroupDto)
  async groups(
    @CurrentUser() trader: AuthenticatedUser,
    @Query() query: ListTraderCounterpartyGroupsQueryDto,
  ): Promise<Page<TraderCounterpartyGroupDto>> {
    const page = await this.bankDetails.listOwnCounterpartyOnly(trader.id, {
      page: query.page,
      limit: query.limit,
      sortOrder: query.sortOrder,
      bankDetailsId: query.bankDetailsId,
    });
    const ids = page.items.map((row) => row.id);
    const [slots, bound] = await Promise.all([
      this.counterparties.countBoundByRequisites(ids),
      this.counterparties.boundTo(ids),
    ]);
    const deposits = new Map(
      (
        await this.stats.traderCounterpartyDeposits(
          trader.id,
          bound,
          new Date(),
        )
      ).map((row) => [row.bankDetailsId, row.deposits30d]),
    );

    return page.map((row) => ({
      requisite: this.requisiteOf(row),
      slots: {
        bound: slots.get(row.id) ?? 0,
        max: row.maxCounterparties ?? null,
      },
      deposits30d: formatFiat(deposits.get(row.id) ?? roundFiat(0)),
    }));
  }

  @Get()
  @ApiOperation({
    summary: 'The clients bound to the trader’s counterparty-only requisites',
    description: `${SCOPE} Filters: bankDetailsId, hideInactive; sortBy id · conversion · averageCheck · volume · lastDealAt.`,
  })
  @ApiPagedResponse(TraderCounterpartyDto)
  async list(
    @CurrentUser() trader: AuthenticatedUser,
    @Query() query: ListTraderCounterpartiesQueryDto,
  ): Promise<Page<TraderCounterpartyDto>> {
    const bound = await this.counterparties.boundTo(
      await this.bankDetails.ownCounterpartyOnlyIds(
        trader.id,
        query.bankDetailsId,
      ),
    );
    const page = await this.stats.traderCounterpartyPage(
      trader.id,
      bound,
      {
        page: query.page,
        limit: query.limit,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
        hideInactive: query.hideInactive,
      },
      new Date(),
    );

    return page.map((row) => ({
      id: row.id,
      bankDetailsId: row.bankDetailsId,
      status: row.active
        ? TraderCounterpartyStatus.Active
        : TraderCounterpartyStatus.Inactive,
      conversion: percentOf(row.paidCount, row.completedCount),
      paidCount: row.paidCount,
      completedCount: row.completedCount,
      averageCheck: averageCheckOf(row.paidAmount, row.paidCount),
      volume: formatFiat(row.paidAmount),
      lastDealAt: row.lastDealAt,
    }));
  }

  @Post(':id/move')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @ApiOperation({
    summary:
      'Move a client to another of the trader’s counterparty-only requisites',
    description:
      'The slot moves with it; its deals stay where they are. Not the trader’s client or not the trader’s requisite: 404; not counterparty-only, the same requisite or no free slot: 409; the requisite does not carry the client’s binding type: 400.',
  })
  @ApiEnvelopeResponse(TraderCounterpartyBindingDto)
  async move(
    @CurrentUser() trader: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MoveCounterpartyDto,
  ): Promise<TraderCounterpartyBindingDto> {
    assertIdInRange(id);

    const moved = await this.bankDetails.moveOwnCounterparty(
      trader.id,
      id,
      dto.bankDetailsId,
      trader.impersonatedBy ?? null,
    );

    return { id: moved.id, bankDetailsId: moved.bankDetailsId as string };
  }

  @Delete(':id')
  @WriteAccess()
  @ApiOperation({
    summary: 'Let a client go: unbind it from the trader’s requisite',
    description:
      'The client stays the merchant’s; its next deposit is bound by the general rule, to this trader again if selection gives it one. Not the trader’s client: 404.',
  })
  @ApiEnvelopeResponse()
  async remove(
    @CurrentUser() trader: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<null> {
    assertIdInRange(id);

    await this.counterparties.unbind(id, trader.id, {
      boundToAnyOf: await this.bankDetails.findIdsOfUsers([trader.id]),
      impersonatorUserId: trader.impersonatedBy ?? null,
    });

    return null;
  }

  private requisiteOf(row: BankDetails): TraderCounterpartyRequisiteDto {
    return {
      id: row.id,
      type: row.type,
      bank: row.bank ? { id: row.bank.id, name: row.bank.name } : null,
      cardholderName: row.cardholderName ?? null,
      phone: row.phone ?? null,
      card: row.card ?? null,
      status: row.bannedAt
        ? BankDetailsStatus.Banned
        : row.active
          ? BankDetailsStatus.Active
          : BankDetailsStatus.Disabled,
    };
  }
}
