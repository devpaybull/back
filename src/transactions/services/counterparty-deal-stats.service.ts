import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { Page, toPage } from '../../common/types/page';
import { addCalendarDays } from '../../common/utils/add-calendar-days';
import { calendarDateIn } from '../../common/utils/calendar-date-in';
import { sortDirection } from '../../common/utils/sort-direction';
import { toFiat } from '../../common/utils/to-fiat';
import { zonedMidnight } from '../../common/utils/zoned-midnight';
import { CounterpartyStatsService } from '../../counterparties/services/counterparty-stats.service';
import { MerchantRequestHistoryService } from '../../merchant-requests/services/merchant-request-history.service';
import { CounterpartyRequestCounts } from '../../merchant-requests/types/counterparty-request-counts';
import { TransactionStatusEvent } from '../entities/transaction-status-event.entity';
import { Transaction } from '../entities/transaction.entity';
import { CounterpartyDealEventListQuery } from '../types/counterparty-deal-event-list-query';
import { CounterpartyDealStats } from '../types/counterparty-deal-stats';
import { CounterpartyRebuildResult } from '../types/counterparty-rebuild-result';
import { CounterpartyRequestCountersRebuild } from '../types/counterparty-request-counters-rebuild.enum';
import { TraderCounterpartyDeposits } from '../types/trader-counterparty-deposits';
import { TraderCounterpartyListQuery } from '../types/trader-counterparty-list-query';
import { TraderCounterpartyRef } from '../types/trader-counterparty-ref';
import { TraderCounterpartySortField } from '../types/trader-counterparty-sort-field.enum';
import { TraderCounterpartyStats } from '../types/trader-counterparty-stats';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';
import { COUNTERPARTY_STATS_METHOD_CODES } from '../utils/counterparty-stats-method-codes';

const PAID = `deal.status IN ('${TransactionStatus.Success}', '${TransactionStatus.SuccessChanged}')`;
const COMPLETED = `deal.status IN ('${TransactionStatus.Success}', '${TransactionStatus.SuccessChanged}', '${TransactionStatus.Canceled}')`;
const DISPUTED = `EXISTS (SELECT 1 FROM transaction_status_events disputed WHERE disputed."transactionId" = deal.id AND disputed."toStatus" = '${TransactionStatus.Dispute}')`;

const TRADER_DEALS = `deal."traderUserId" = $1 AND deal.kind = '${TransactionKind.PayIn}' AND deal.method = ANY($2::varchar[])`;

const TRADER_SORT: Record<TraderCounterpartySortField, string> = {
  [TraderCounterpartySortField.Id]: 'listed.id',
  [TraderCounterpartySortField.Conversion]:
    'CASE WHEN listed."completedCount" = 0 THEN NULL ELSE listed."paidCount"::numeric / listed."completedCount" END',
  [TraderCounterpartySortField.AverageCheck]:
    'CASE WHEN listed."paidCount" = 0 THEN NULL ELSE listed."paidAmount" / listed."paidCount" END',
  [TraderCounterpartySortField.Volume]: 'listed."paidAmount"',
  [TraderCounterpartySortField.LastDealAt]: 'listed."lastDealAt"',
};

interface TotalsRow {
  dealCount: string;
  completedCount: string;
  paidCount: string;
  disputeCount: string;
  paidAmount: string;
  lastDepositAt: Date | null;
}

@Injectable()
export class CounterpartyDealStatsService {
  private readonly logger = new Logger(CounterpartyDealStatsService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
    @InjectRepository(TransactionStatusEvent)
    private readonly events: Repository<TransactionStatusEvent>,
    private readonly counterpartyStats: CounterpartyStatsService,
    private readonly requestLog: MerchantRequestHistoryService,
    private readonly config: ConfigService,
  ) {}

  async statsOf(
    counterpartyId: number,
    method: string | undefined,
    now: Date,
  ): Promise<CounterpartyDealStats> {
    const timeZone = this.timeZone();
    const today = calendarDateIn(now, timeZone);
    const from7 = zonedMidnight(addCalendarDays(today, -6), timeZone);
    const from30 = zonedMidnight(addCalendarDays(today, -29), timeZone);

    const row = await this.withTotals(
      this.countedDeals(method ? [method] : COUNTERPARTY_STATS_METHOD_CODES),
    )
      .addSelect(
        `COALESCE(SUM(deal.amountFiat) FILTER (WHERE ${PAID} AND deal.resolvedAt >= :from7), 0)`,
        'volume7d',
      )
      .addSelect(
        `COALESCE(SUM(deal.amountFiat) FILTER (WHERE ${PAID} AND deal.resolvedAt >= :from30), 0)`,
        'volume30d',
      )
      .andWhere('deal.counterpartyId = :counterpartyId', { counterpartyId })
      .setParameters({ from7, from30 })
      .getRawOne<TotalsRow & { volume7d: string; volume30d: string }>();

    return {
      ...this.toTotals(row),
      volume7d: toFiat(row?.volume7d ?? 0),
      volume30d: toFiat(row?.volume30d ?? 0),
    };
  }

  async listDealEvents(
    counterpartyId: number,
    query: CounterpartyDealEventListQuery,
  ): Promise<Page<TransactionStatusEvent>> {
    const direction = sortDirection(query.sortOrder);

    return toPage(
      await this.events
        .createQueryBuilder('event')
        .innerJoinAndSelect('event.transaction', 'transaction')
        .where('transaction.counterpartyId = :counterpartyId', {
          counterpartyId,
        })
        .orderBy('event.createdAt', direction)
        .addOrderBy('event.id', direction)
        .offset((query.page - 1) * query.limit)
        .limit(query.limit)
        .getManyAndCount(),
      query,
    );
  }

  async rebuildCounterpartyStats(): Promise<CounterpartyRebuildResult> {
    const totals = await this.withTotals(
      this.countedDeals(COUNTERPARTY_STATS_METHOD_CODES),
    )
      .addSelect('deal.counterpartyId', 'counterpartyId')
      .groupBy('deal.counterpartyId')
      .getRawMany<TotalsRow & { counterpartyId: number }>();
    const days = await this.countedDeals(COUNTERPARTY_STATS_METHOD_CODES)
      .select('deal.counterpartyId', 'counterpartyId')
      .addSelect(
        `to_char(deal.resolvedAt AT TIME ZONE :timeZone, 'YYYY-MM-DD')`,
        'day',
      )
      .addSelect('COUNT(*)', 'paidCount')
      .addSelect('SUM(deal.amountFiat)', 'paidAmount')
      .andWhere(PAID)
      .andWhere('deal.resolvedAt IS NOT NULL')
      .setParameter('timeZone', this.timeZone())
      .groupBy('deal.counterpartyId')
      .addGroupBy('day')
      .getRawMany<{
        counterpartyId: number;
        day: string;
        paidCount: string;
        paidAmount: string;
      }>();

    const archived = await this.archivedRequestCounts();

    await this.dataSource.transaction(async (manager) => {
      await this.counterpartyStats.replaceAllWithin(
        manager,
        totals.map((row) => ({
          counterpartyId: Number(row.counterpartyId),
          ...this.toTotals(row),
        })),
        days.map((row) => ({
          counterpartyId: Number(row.counterpartyId),
          day: row.day,
          paidCount: Number(row.paidCount),
          paidAmount: toFiat(row.paidAmount),
        })),
      );

      if (archived === null) return;

      await this.counterpartyStats.lockRequestCountersWithin(
        manager,
        'exclusive',
      );

      const requests =
        await this.requestLog.storedCounterpartyRequestCountsWithin(
          manager,
          this.timeZone(),
          archived,
        );

      await this.counterpartyStats.replaceRequestsWithin(
        manager,
        requests.totals,
        requests.days,
      );
    });

    return {
      requestCounters:
        archived === null
          ? CounterpartyRequestCountersRebuild.Skipped
          : CounterpartyRequestCountersRebuild.Rebuilt,
    };
  }

  private async archivedRequestCounts(): Promise<CounterpartyRequestCounts | null> {
    try {
      return await this.requestLog.archivedCounterpartyRequestCounts(
        this.timeZone(),
      );
    } catch (error) {
      this.logger.warn(
        `Counterparty request counters left as they are: the request log archive could not be read (${(error as Error).message})`,
      );

      return null;
    }
  }

  async traderCounterpartyPage(
    traderUserId: string,
    bound: readonly TraderCounterpartyRef[],
    query: TraderCounterpartyListQuery,
    now: Date,
  ): Promise<Page<TraderCounterpartyStats>> {
    if (bound.length === 0) return toPage([[], 0], query);

    const direction = query.sortOrder === SortOrder.Asc ? 'ASC' : 'DESC';
    const rows = `
      WITH bound AS (
        SELECT * FROM unnest($3::int[], $4::uuid[], $5::boolean[]) AS b(id, "bankDetailsId", available)
      ), stats AS (
        SELECT deal."counterpartyId" AS id,
          COUNT(*) FILTER (WHERE ${COMPLETED}) AS "completedCount",
          COUNT(*) FILTER (WHERE ${PAID}) AS "paidCount",
          COALESCE(SUM(deal."amountFiat") FILTER (WHERE ${PAID}), 0) AS "paidAmount",
          MAX(deal."resolvedAt") FILTER (WHERE ${PAID}) AS "lastPaidAt",
          MAX(deal."createdAt") AS "lastDealAt"
        FROM transactions deal
        WHERE ${TRADER_DEALS} AND deal."counterpartyId" = ANY($3::int[])
        GROUP BY deal."counterpartyId"
      ), listed AS (
        SELECT bound.id, bound."bankDetailsId",
          COALESCE(bound.available AND stats."lastPaidAt" >= $6, false) AS active,
          COALESCE(stats."completedCount", 0) AS "completedCount",
          COALESCE(stats."paidCount", 0) AS "paidCount",
          COALESCE(stats."paidAmount", 0) AS "paidAmount",
          stats."lastDealAt"
        FROM bound LEFT JOIN stats ON stats.id = bound.id
      )`;
    const shown = 'FROM listed WHERE ($7::boolean = false OR listed.active)';
    const parameters = [
      traderUserId,
      COUNTERPARTY_STATS_METHOD_CODES,
      bound.map((ref) => ref.id),
      bound.map((ref) => ref.bankDetailsId),
      bound.map((ref) => ref.available),
      this.windowStart(now, 30),
      query.hideInactive,
    ];
    const [page, counted] = await Promise.all([
      this.dataSource.query(
        `${rows} SELECT listed.* ${shown} ORDER BY ${TRADER_SORT[query.sortBy]} ${direction} NULLS LAST, listed.id ${direction} LIMIT $8 OFFSET $9`,
        [...parameters, query.limit, (query.page - 1) * query.limit],
      ) as Promise<
        {
          id: number;
          bankDetailsId: string;
          active: boolean;
          completedCount: string;
          paidCount: string;
          paidAmount: string;
          lastDealAt: Date | null;
        }[]
      >,
      this.dataSource.query(
        `${rows} SELECT COUNT(*) AS total ${shown}`,
        parameters,
      ) as Promise<{ total: string }[]>,
    ]);

    return toPage(
      [
        page.map((row) => ({
          id: Number(row.id),
          bankDetailsId: row.bankDetailsId,
          active: row.active,
          completedCount: Number(row.completedCount),
          paidCount: Number(row.paidCount),
          paidAmount: toFiat(row.paidAmount),
          lastDealAt: row.lastDealAt ? new Date(row.lastDealAt) : null,
        })),
        Number(counted[0]?.total ?? 0),
      ],
      query,
    );
  }

  async traderCounterpartyDeposits(
    traderUserId: string,
    bound: readonly TraderCounterpartyRef[],
    now: Date,
  ): Promise<TraderCounterpartyDeposits[]> {
    if (bound.length === 0) return [];

    const rows = (await this.dataSource.query(
      `SELECT bound."bankDetailsId",
          COUNT(*) FILTER (WHERE ${COMPLETED}) AS "completedCount",
          COUNT(*) FILTER (WHERE ${PAID}) AS "paidCount",
          COALESCE(SUM(deal."amountFiat") FILTER (WHERE ${PAID}), 0) AS "paidAmount",
          COALESCE(SUM(deal."amountFiat") FILTER (WHERE ${PAID} AND deal."resolvedAt" >= $5), 0) AS "deposits30d"
        FROM unnest($3::int[], $4::uuid[]) AS bound(id, "bankDetailsId")
        JOIN transactions deal ON deal."counterpartyId" = bound.id AND ${TRADER_DEALS}
        GROUP BY bound."bankDetailsId"`,
      [
        traderUserId,
        COUNTERPARTY_STATS_METHOD_CODES,
        bound.map((ref) => ref.id),
        bound.map((ref) => ref.bankDetailsId),
        this.windowStart(now, 30),
      ],
    )) as {
      bankDetailsId: string;
      completedCount: string;
      paidCount: string;
      paidAmount: string;
      deposits30d: string;
    }[];

    return rows.map((row) => ({
      bankDetailsId: row.bankDetailsId,
      completedCount: Number(row.completedCount),
      paidCount: Number(row.paidCount),
      paidAmount: toFiat(row.paidAmount),
      deposits30d: toFiat(row.deposits30d),
    }));
  }

  private windowStart(now: Date, days: number): Date {
    const timeZone = this.timeZone();

    return zonedMidnight(
      addCalendarDays(calendarDateIn(now, timeZone), 1 - days),
      timeZone,
    );
  }

  private countedDeals(
    methods: readonly string[],
  ): SelectQueryBuilder<Transaction> {
    return this.transactions
      .createQueryBuilder('deal')
      .where('deal.kind = :kind', { kind: TransactionKind.PayIn })
      .andWhere('deal.counterpartyId IS NOT NULL')
      .andWhere('deal.method IN (:...methods)', { methods });
  }

  private withTotals(
    builder: SelectQueryBuilder<Transaction>,
  ): SelectQueryBuilder<Transaction> {
    return builder
      .select('COUNT(*)', 'dealCount')
      .addSelect(`COUNT(*) FILTER (WHERE ${COMPLETED})`, 'completedCount')
      .addSelect(`COUNT(*) FILTER (WHERE ${PAID})`, 'paidCount')
      .addSelect(`COUNT(*) FILTER (WHERE ${DISPUTED})`, 'disputeCount')
      .addSelect(
        `COALESCE(SUM(deal.amountFiat) FILTER (WHERE ${PAID}), 0)`,
        'paidAmount',
      )
      .addSelect(
        `MAX(deal.resolvedAt) FILTER (WHERE ${PAID})`,
        'lastDepositAt',
      );
  }

  private toTotals(
    row: TotalsRow | undefined,
  ): Omit<CounterpartyDealStats, 'volume7d' | 'volume30d'> {
    return {
      dealCount: Number(row?.dealCount ?? 0),
      completedCount: Number(row?.completedCount ?? 0),
      paidCount: Number(row?.paidCount ?? 0),
      disputeCount: Number(row?.disputeCount ?? 0),
      paidAmount: toFiat(row?.paidAmount ?? 0),
      lastDepositAt: row?.lastDepositAt ? new Date(row.lastDepositAt) : null,
    };
  }

  private timeZone(): string {
    return this.config.get<string>('BUSINESS_TIMEZONE');
  }
}
