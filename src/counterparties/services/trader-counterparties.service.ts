import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { Page, toPage } from '../../common/types/page';
import { addCalendarDays } from '../../common/utils/add-calendar-days';
import { calendarDateIn } from '../../common/utils/calendar-date-in';
import { toFiat } from '../../common/utils/to-fiat';
import { zonedMidnight } from '../../common/utils/zoned-midnight';
import { Counterparty } from '../entities/counterparty.entity';
import { TraderCounterpartyListQuery } from '../types/trader-counterparty-list-query';
import { TraderCounterpartySortField } from '../types/trader-counterparty-sort-field.enum';
import { TraderCounterpartyStats } from '../types/trader-counterparty-stats';
import { TraderRequisiteCounterpartyTotals } from '../types/trader-requisite-counterparty-totals';

const ACTIVE_WINDOW_DAYS = 30;

const SORT: Record<TraderCounterpartySortField, string> = {
  [TraderCounterpartySortField.Id]: 'listed.id',
  [TraderCounterpartySortField.Conversion]:
    'CASE WHEN listed."completedCount" = 0 THEN NULL ELSE listed."paidCount"::numeric / listed."completedCount" END',
  [TraderCounterpartySortField.AverageCheck]:
    'CASE WHEN listed."paidCount" = 0 THEN NULL ELSE listed."paidAmount" / listed."paidCount" END',
  [TraderCounterpartySortField.Volume]: 'listed."paidAmount"',
  [TraderCounterpartySortField.LastDealAt]: 'listed."lastDealAt"',
};

const LISTED = `WITH listed AS (
  SELECT counterparty.id, counterparty."bankDetailsId",
    COALESCE(counterparty.enabled AND counterparty."blacklistedAt" IS NULL AND stats."lastPaidAt" >= $3, false) AS active,
    COALESCE(stats."completedCount", 0) AS "completedCount",
    COALESCE(stats."paidCount", 0) AS "paidCount",
    COALESCE(stats."paidAmount", 0) AS "paidAmount",
    stats."lastDealAt"
  FROM counterparties counterparty
  LEFT JOIN counterparty_trader_stats stats
    ON stats."counterpartyId" = counterparty.id AND stats."traderUserId" = $1
  WHERE counterparty."bankDetailsId" = ANY($2::uuid[])
)`;
const SHOWN = 'FROM listed WHERE ($4::boolean = false OR listed.active)';

const BY_REQUISITE = `SELECT counterparty."bankDetailsId",
    COUNT(*) AS bound,
    COALESCE(SUM(stats."completedCount"), 0) AS "completedCount",
    COALESCE(SUM(stats."paidCount"), 0) AS "paidCount",
    COALESCE(SUM(stats."paidAmount"), 0) AS "paidAmount",
    COALESCE(SUM(recent.amount), 0) AS "deposits30d"
  FROM counterparties counterparty
  LEFT JOIN counterparty_trader_stats stats
    ON stats."counterpartyId" = counterparty.id AND stats."traderUserId" = $1
  LEFT JOIN LATERAL (
    SELECT SUM(volume."paidAmount") AS amount
    FROM counterparty_trader_daily_volumes volume
    WHERE volume."counterpartyId" = counterparty.id
      AND volume."traderUserId" = $1
      AND volume.day >= $3::date
  ) recent ON true
  WHERE counterparty."bankDetailsId" = ANY($2::uuid[])
  GROUP BY counterparty."bankDetailsId"`;

@Injectable()
export class TraderCounterpartiesService {
  constructor(
    @InjectRepository(Counterparty)
    private readonly counterparties: Repository<Counterparty>,
    private readonly config: ConfigService,
  ) {}

  async page(
    traderUserId: string,
    bankDetailsIds: readonly string[],
    query: TraderCounterpartyListQuery,
    now: Date,
  ): Promise<Page<TraderCounterpartyStats>> {
    if (bankDetailsIds.length === 0) return toPage([[], 0], query);

    const direction = query.sortOrder === SortOrder.Asc ? 'ASC' : 'DESC';
    const parameters = [
      traderUserId,
      [...bankDetailsIds],
      zonedMidnight(this.firstActiveDay(now), this.timeZone()),
      query.hideInactive,
    ];
    const [rows, counted] = await Promise.all([
      this.counterparties.query(
        `${LISTED} SELECT listed.* ${SHOWN} ORDER BY ${SORT[query.sortBy]} ${direction} NULLS LAST, listed.id ${direction} LIMIT $5 OFFSET $6`,
        [...parameters, query.limit, (query.page - 1) * query.limit],
      ) as Promise<
        {
          id: number;
          bankDetailsId: string;
          active: boolean;
          completedCount: number | string;
          paidCount: number | string;
          paidAmount: string;
          lastDealAt: Date | null;
        }[]
      >,
      this.counterparties.query(
        `${LISTED} SELECT COUNT(*) AS total ${SHOWN}`,
        parameters,
      ) as Promise<{ total: string }[]>,
    ]);

    return toPage(
      [
        rows.map((row) => ({
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

  async totalsByRequisite(
    traderUserId: string,
    bankDetailsIds: readonly string[],
    now: Date,
  ): Promise<TraderRequisiteCounterpartyTotals[]> {
    if (bankDetailsIds.length === 0) return [];

    const rows = (await this.counterparties.query(BY_REQUISITE, [
      traderUserId,
      [...bankDetailsIds],
      this.firstActiveDay(now),
    ])) as {
      bankDetailsId: string;
      bound: string;
      completedCount: string;
      paidCount: string;
      paidAmount: string;
      deposits30d: string;
    }[];

    return rows.map((row) => ({
      bankDetailsId: row.bankDetailsId,
      bound: Number(row.bound),
      completedCount: Number(row.completedCount),
      paidCount: Number(row.paidCount),
      paidAmount: toFiat(row.paidAmount),
      deposits30d: toFiat(row.deposits30d),
    }));
  }

  private firstActiveDay(now: Date): string {
    return addCalendarDays(
      calendarDateIn(now, this.timeZone()),
      1 - ACTIVE_WINDOW_DAYS,
    );
  }

  private timeZone(): string {
    return this.config.getOrThrow<string>('BUSINESS_TIMEZONE');
  }
}
