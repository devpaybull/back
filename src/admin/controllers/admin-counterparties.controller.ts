import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BankDetails } from '../../bank-details/entities/bank-details.entity';
import { BankDetailsService } from '../../bank-details/bank-details.service';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WriteAccess } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page, toPage } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { formatFiat } from '../../common/utils/format-fiat';
import { MERGED_SORT_WINDOW_MAX } from '../../common/utils/merged-sort-window-max';
import { INT4_MAX } from '../../common/utils/int4-max';
import { averageCheckOf } from '../../common/utils/average-check-of';
import { percentOf } from '../../common/utils/percent-of';
import { toFiat } from '../../common/utils/to-fiat';
import { Counterparty } from '../../counterparties/entities/counterparty.entity';
import { CounterpartiesService } from '../../counterparties/services/counterparties.service';
import { AmountRange } from '../../counterparties/types/amount-range';
import { CounterpartyFilter } from '../../counterparties/types/counterparty-filter';
import { CounterpartyWindowVolumes } from '../../counterparties/types/counterparty-window-volumes';
import { VolumeWindow } from '../../counterparties/types/volume-window';
import { counterpartyHealth } from '../../counterparties/utils/counterparty-health';
import { COUNTERPARTY_STATS_CURRENCY } from '../../counterparties/utils/counterparty-stats-currency';
import { MerchantRequestHistoryService } from '../../merchant-requests/services/merchant-request-history.service';
import { MerchantsService } from '../../merchants/services/merchants.service';
import { CounterpartyDealStatsService } from '../../transactions/services/counterparty-deal-stats.service';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { BindCounterpartyRequisiteDto } from '../dto/bind-counterparty-requisite.dto';
import { CounterpartyDealEventDto } from '../dto/counterparty-deal-event.dto';
import { CounterpartyRequisiteEventDto } from '../dto/counterparty-requisite-event.dto';
import { toCounterpartyRequisiteDto } from '../dto/counterparty-requisite.dto';
import { CounterpartyStatsQueryDto } from '../dto/counterparty-stats-query.dto';
import { CounterpartyStatsDto } from '../dto/counterparty-stats.dto';
import { CounterpartyStatusCountsDto } from '../dto/counterparty-status-counts.dto';
import { toCounterpartyTraderDto } from '../dto/counterparty-trader.dto';
import { CounterpartyDto } from '../dto/counterparty.dto';
import { ListCounterpartiesQueryDto } from '../dto/list-counterparties-query.dto';
import { ListCounterpartyEventsQueryDto } from '../dto/list-counterparty-events-query.dto';
import { ReplaceCounterpartyRequisiteDto } from '../dto/replace-counterparty-requisite.dto';
import { UpdateCounterpartyDto } from '../dto/update-counterparty.dto';
import { CounterpartyDealEventKind } from '../types/counterparty-deal-event-kind.enum';

const assertIdInRange = (id: number): void => {
  if (id < 1 || id > INT4_MAX) {
    throw new BadRequestException('Counterparty id is out of range');
  }
};

const rangeOf = (from?: string, to?: string): AmountRange | undefined =>
  from === undefined && to === undefined
    ? undefined
    : {
        from: from === undefined ? undefined : toFiat(from),
        to: to === undefined ? undefined : toFiat(to),
      };

const distinct = <T>(values: (T | null | undefined)[]): T[] => [
  ...new Set(
    values.filter((value): value is T => value !== null && value !== undefined),
  ),
];

@ApiTags('Admin · Counterparties')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/counterparties')
export class AdminCounterpartiesController {
  constructor(
    private readonly counterparties: CounterpartiesService,
    private readonly dealStats: CounterpartyDealStatsService,
    private readonly bankDetails: BankDetailsService,
    private readonly merchants: MerchantsService,
    private readonly directory: UserDirectoryService,
    private readonly requestLog: MerchantRequestHistoryService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lists counterparties across every merchant' })
  @ApiPagedResponse(CounterpartyDto)
  async list(
    @Query() query: ListCounterpartiesQueryDto,
  ): Promise<Page<CounterpartyDto>> {
    const now = new Date();
    const page = await this.counterparties.list(
      {
        ...(await this.filterOf(query)),
        page: query.page,
        limit: query.limit,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      },
      now,
    );
    return new Page(await this.withDetails(page.items, now), page.meta);
  }

  @Get('counts')
  @ApiOperation({
    summary: 'Counts the counterparties of the tabs under the same filters',
  })
  @ApiEnvelopeResponse(CounterpartyStatusCountsDto)
  async counts(
    @Query() query: ListCounterpartiesQueryDto,
  ): Promise<CounterpartyStatusCountsDto> {
    return this.counterparties.countByStatus(
      await this.filterOf(query),
      new Date(),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Reads one counterparty' })
  @ApiEnvelopeResponse(CounterpartyDto)
  async findOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CounterpartyDto> {
    return this.toDto(await this.require(id));
  }

  @Get(':id/stats')
  @ApiOperation({
    summary: 'The counterparty’s statistics, for one method or every one',
  })
  @ApiEnvelopeResponse(CounterpartyStatsDto)
  async stats(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: CounterpartyStatsQueryDto,
  ): Promise<CounterpartyStatsDto> {
    const counterparty = await this.require(id);
    const [stats, requests] = await Promise.all([
      this.dealStats.statsOf(id, query.method, new Date()),
      query.method === undefined
        ? counterparty.requestCount
        : this.requestLog.countForCounterparty(id, query.method),
    ]);

    return {
      method: query.method ?? null,
      currency: COUNTERPARTY_STATS_CURRENCY,
      conversion: percentOf(stats.paidCount, stats.completedCount),
      completedCount: stats.completedCount,
      paidCount: stats.paidCount,
      disputes: stats.disputeCount,
      averageCheck: averageCheckOf(stats.paidAmount, stats.paidCount),
      lastDepositAt: stats.lastDepositAt,
      funnel: { requests, deals: stats.dealCount, paid: stats.paidCount },
      volume7d: formatFiat(stats.volume7d),
      volume30d: formatFiat(stats.volume30d),
      volumeTotal: formatFiat(stats.paidAmount),
    };
  }

  @Patch(':id')
  @WriteAccess()
  @ApiOperation({
    summary:
      'Enables, disables, blacklists or forbids auto-enabling a counterparty',
  })
  @ApiEnvelopeResponse(CounterpartyDto)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCounterpartyDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<CounterpartyDto> {
    assertIdInRange(id);

    return this.toDto(await this.counterparties.update(id, dto, admin.id));
  }

  @Post(':id/requisite')
  @WriteAccess()
  @ApiOperation({ summary: 'Binds a counterparty-only requisite' })
  @ApiEnvelopeResponse(CounterpartyDto, { status: HttpStatus.CREATED })
  async bind(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BindCounterpartyRequisiteDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<CounterpartyDto> {
    assertIdInRange(id);

    return this.toDto(
      await this.bankDetails.bindToCounterparty(
        dto.bankDetailsId,
        id,
        dto.bindingType,
        admin.id,
      ),
    );
  }

  @Put(':id/requisite')
  @WriteAccess()
  @ApiOperation({ summary: 'Replaces the bound requisite' })
  @ApiEnvelopeResponse(CounterpartyDto)
  async replace(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReplaceCounterpartyRequisiteDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<CounterpartyDto> {
    assertIdInRange(id);

    return this.toDto(
      await this.bankDetails.replaceCounterpartyRequisite(
        dto.bankDetailsId,
        id,
        admin.id,
      ),
    );
  }

  @Delete(':id/requisite')
  @WriteAccess()
  @ApiOperation({ summary: 'Unbinds the requisite' })
  @ApiEnvelopeResponse(CounterpartyDto)
  async unbind(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<CounterpartyDto> {
    assertIdInRange(id);

    return this.toDto(await this.counterparties.unbind(id, admin.id));
  }

  @Get(':id/deal-events')
  @ApiOperation({
    summary:
      'Every status change of the counterparty’s deals and every creation request it made, by time',
    description: `«Запрос на создание сделки» rows come from the request log, Postgres and the archive. A page may end at most ${MERGED_SORT_WINDOW_MAX} events deep (400 beyond).`,
  })
  @ApiPagedResponse(CounterpartyDealEventDto)
  async dealEvents(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ListCounterpartyEventsQueryDto,
  ): Promise<Page<CounterpartyDealEventDto>> {
    await this.require(id);
    const window = query.page * query.limit;

    if (window > MERGED_SORT_WINDOW_MAX) {
      throw new BadRequestException(
        `A page of events may end at most ${MERGED_SORT_WINDOW_MAX} events deep`,
      );
    }

    const [statusPage, [requests, requestTotal]] = await Promise.all([
      this.dealStats.listDealEvents(id, {
        page: 1,
        limit: window,
        sortOrder: query.sortOrder,
      }),
      this.requestLog.listForCounterparty(id, query.sortOrder, window),
    ]);
    const sign = query.sortOrder === SortOrder.Asc ? 1 : -1;
    const merged = [
      ...statusPage.items.map((event) => ({
        at: event.createdAt,
        key: `s${String(event.id).padStart(12, '0')}`,
        status: event,
        request: null,
      })),
      ...requests.map((request) => ({
        at: request.receivedAt,
        key: `r${request.id}`,
        status: null,
        request,
      })),
    ]
      .sort(
        (a, b) =>
          sign *
          (a.at.getTime() - b.at.getTime() ||
            (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
      )
      .slice((query.page - 1) * query.limit, window);
    const [traders, requisites] = await Promise.all([
      this.directory.findByIds(
        distinct(
          merged.map((entry) =>
            entry.status
              ? entry.status.transaction.traderUserId
              : entry.request.processedByUserId,
          ),
        ),
      ),
      this.bankDetails.findByIdsWithDeleted(
        distinct(
          merged.map((entry) => entry.status?.transaction.bankDetailsId),
        ),
      ),
    ]);
    const traderById = new Map(traders.map((user) => [user.id, user]));
    const requisiteById = new Map(requisites.map((row) => [row.id, row]));
    const items = merged.map((entry): CounterpartyDealEventDto => {
      if (entry.request) {
        const request = entry.request;
        const trader = request.processedByUserId
          ? traderById.get(request.processedByUserId)
          : undefined;

        return {
          kind: CounterpartyDealEventKind.DealRequested,
          id: null,
          createdAt: request.receivedAt,
          fromStatus: null,
          toStatus: null,
          source: null,
          deal: null,
          trader: trader ? toCounterpartyTraderDto(trader) : null,
          requisite: null,
          request: {
            id: request.id,
            method: request.paymentMethod,
            amountFiat:
              request.amountFiat === null
                ? null
                : formatFiat(request.amountFiat),
            currency: request.currency,
            result: request.result,
            statusCode: request.statusCode,
            errorCode: request.errorCode,
            dealId: request.transactionId,
          },
        };
      }

      const event = entry.status;
      const deal = event.transaction;
      const trader = traderById.get(deal.traderUserId);
      const requisite = requisiteById.get(deal.bankDetailsId);

      return {
        kind: CounterpartyDealEventKind.StatusChanged,
        id: event.id,
        createdAt: event.createdAt,
        fromStatus: event.fromStatus ?? null,
        toStatus: event.toStatus,
        source: event.source,
        deal: {
          id: deal.id,
          kind: deal.kind,
          method: deal.method,
          status: deal.status,
          amountFiat: formatFiat(deal.amountFiat),
        },
        trader: trader ? toCounterpartyTraderDto(trader) : null,
        requisite: requisite
          ? toCounterpartyRequisiteDto({
              ...requisite,
              user: trader,
            } as BankDetails)
          : null,
        request: null,
      };
    });

    return toPage([items, statusPage.meta.total + requestTotal], query);
  }

  @Get(':id/requisite-events')
  @ApiOperation({ summary: 'Every bind and unbind of the counterparty' })
  @ApiPagedResponse(CounterpartyRequisiteEventDto)
  async requisiteEvents(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ListCounterpartyEventsQueryDto,
  ): Promise<Page<CounterpartyRequisiteEventDto>> {
    await this.require(id);
    const page = await this.counterparties.listRequisiteEvents(id, query);
    const requisites = await this.bankDetails.findByIdsWithDeleted(
      distinct(page.items.map((event) => event.bankDetailsId)),
    );
    const users = await this.directory.findByIds(
      distinct([
        ...page.items.map((event) => event.actorUserId),
        ...requisites.map((row) => row.userId),
      ]),
    );
    const userById = new Map(users.map((user) => [user.id, user]));
    const requisiteById = new Map(requisites.map((row) => [row.id, row]));

    return page.map((event) => {
      const actor = userById.get(event.actorUserId);
      const requisite = requisiteById.get(event.bankDetailsId);

      return {
        id: event.id,
        createdAt: event.createdAt,
        kind: event.kind,
        source: event.source,
        reason: event.reason ?? null,
        actor: actor ? toCounterpartyTraderDto(actor) : null,
        requisite: requisite
          ? toCounterpartyRequisiteDto({
              ...requisite,
              user: userById.get(requisite.userId),
            } as BankDetails)
          : null,
      };
    });
  }

  private async require(id: number): Promise<Counterparty> {
    assertIdInRange(id);
    const found = await this.counterparties.findById(id);

    if (!found) throw new NotFoundException('Counterparty not found');

    return found;
  }

  private async toDto(counterparty: Counterparty): Promise<CounterpartyDto> {
    const [row] = await this.withDetails([counterparty], new Date());

    return row;
  }

  private async filterOf(
    query: ListCounterpartiesQueryDto,
  ): Promise<CounterpartyFilter> {
    const windowVolumes = new Map<VolumeWindow, AmountRange>();
    for (const [window, from, to] of [
      [7, query.volume7dFrom, query.volume7dTo],
      [30, query.volume30dFrom, query.volume30dTo],
      [60, query.volume60dFrom, query.volume60dTo],
      [90, query.volume90dFrom, query.volume90dTo],
    ] as const) {
      const range = rangeOf(from, to);
      if (range) windowVolumes.set(window, range);
    }

    let bankDetailsIds: string[] | undefined;
    if (query.traderUserId !== undefined) {
      bankDetailsIds = await this.bankDetails.findIdsOfUsers([
        query.traderUserId,
      ]);
    }
    if (query.bankDetailsId !== undefined) {
      bankDetailsIds = (bankDetailsIds ?? [query.bankDetailsId]).filter(
        (bankDetailsId) => bankDetailsId === query.bankDetailsId,
      );
    }

    return {
      ...(query.search ? await this.searchOf(query.search) : {}),
      merchantId: query.merchantId,
      bankDetailsIds,
      status: query.status,
      blacklisted: query.blacklisted,
      autoEnableForbidden: query.autoEnableForbidden,
      hasRequisite: query.hasRequisite,
      windowVolumes,
      totalVolume: rangeOf(query.volumeTotalFrom, query.volumeTotalTo),
      paid30d:
        query.paid30dFrom === undefined && query.paid30dTo === undefined
          ? undefined
          : { from: query.paid30dFrom, to: query.paid30dTo },
      requests30d:
        query.requests30dFrom === undefined && query.requests30dTo === undefined
          ? undefined
          : { from: query.requests30dFrom, to: query.requests30dTo },
    };
  }

  private async searchOf(search: string): Promise<CounterpartyFilter> {
    const [searchMerchantIds, traderIds, requisiteIds] = await Promise.all([
      this.merchants.findIdsMatching(search),
      this.directory.findIdsMatching(search),
      this.bankDetails.findIdsMatching(search),
    ]);
    const traderRequisiteIds = await this.bankDetails.findIdsOfUsers(traderIds);

    return {
      search,
      searchMerchantIds,
      searchBankDetailsIds: distinct([...requisiteIds, ...traderRequisiteIds]),
    };
  }

  private async withDetails(
    rows: Counterparty[],
    now: Date,
  ): Promise<CounterpartyDto[]> {
    const [merchants, requisites, volumes] = await Promise.all([
      this.merchants.findByIds(distinct(rows.map((row) => row.merchantId))),
      this.bankDetails.findByIdsInOrder(
        distinct(rows.map((row) => row.bankDetailsId)),
      ),
      this.counterparties.windowVolumesOf(
        rows.map((row) => row.id),
        now,
      ),
    ]);
    const merchantById = new Map(merchants.map((row) => [row.id, row]));
    const requisiteById = new Map(requisites.map((row) => [row.id, row]));

    return rows.map((row) => {
      const merchant = merchantById.get(row.merchantId);
      const requisite = requisiteById.get(row.bankDetailsId);
      const windows: CounterpartyWindowVolumes = volumes.get(row.id) ?? {
        volume7d: toFiat(0),
        volume30d: toFiat(0),
      };

      return {
        id: row.id,
        externalId: row.externalId,
        merchant: merchant ? { id: merchant.id, name: merchant.name } : null,
        name: row.name ?? null,
        contact: row.contact ?? null,
        enabled: row.enabled,
        blacklisted: row.blacklistedAt !== null,
        blacklistedAt: row.blacklistedAt,
        autoEnableForbidden: row.autoEnableForbidden,
        health: counterpartyHealth(row),
        binding:
          requisite && row.bindingType
            ? {
                requisite: toCounterpartyRequisiteDto(requisite),
                bindingType: row.bindingType,
                boundAt: row.boundAt,
              }
            : null,
        disputes: row.disputeCount,
        dealCount: row.dealCount,
        completedCount: row.completedCount,
        paidCount: row.paidCount,
        requestCount: row.requestCount,
        conversion: percentOf(row.paidCount, row.completedCount),
        lastLoginAt: row.lastRequestAt,
        lastDepositAt: row.lastDepositAt,
        averageCheck: averageCheckOf(row.paidAmount, row.paidCount),
        volume7d: formatFiat(windows.volume7d),
        volume30d: formatFiat(windows.volume30d),
        volumeTotal: formatFiat(row.paidAmount),
        currency: COUNTERPARTY_STATS_CURRENCY,
        createdAt: row.createdAt,
      };
    });
  }
}
