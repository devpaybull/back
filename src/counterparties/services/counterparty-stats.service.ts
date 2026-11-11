import { Fiat } from '../../common/types/fiat';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { calendarDateIn } from '../../common/utils/calendar-date-in';
import { formatFiat } from '../../common/utils/format-fiat';
import { CounterpartyDailyRequest } from '../entities/counterparty-daily-request.entity';
import { CounterpartyDailyVolume } from '../entities/counterparty-daily-volume.entity';
import { CounterpartyTraderDailyVolume } from '../entities/counterparty-trader-daily-volume.entity';
import { CounterpartyTraderStats } from '../entities/counterparty-trader-stats.entity';
import { Counterparty } from '../entities/counterparty.entity';
import { CounterpartyDayRequests } from '../types/counterparty-day-requests';
import { CounterpartyDayVolume } from '../types/counterparty-day-volume';
import { CounterpartyDealOutcome } from '../types/counterparty-deal-outcome';
import { CounterpartyRequestTotals } from '../types/counterparty-request-totals';
import { CounterpartyStatsTotals } from '../types/counterparty-stats-totals';
import { CounterpartyTraderDayVolume } from '../types/counterparty-trader-day-volume';
import { CounterpartyTraderTotals } from '../types/counterparty-trader-totals';

const ADD_TO_DAY = `INSERT INTO counterparty_daily_volumes ("counterpartyId", "day", "paidCount", "paidAmount")
VALUES ($1, $2, $3, $4)
ON CONFLICT ("counterpartyId", "day") DO UPDATE SET
  "paidCount" = counterparty_daily_volumes."paidCount" + EXCLUDED."paidCount",
  "paidAmount" = counterparty_daily_volumes."paidAmount" + EXCLUDED."paidAmount",
  "updatedAt" = now()`;

const ADD_TO_TRADER = `INSERT INTO counterparty_trader_stats ("counterpartyId", "traderUserId", "completedCount", "paidCount", "paidAmount", "lastPaidAt", "lastDealAt")
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT ("counterpartyId", "traderUserId") DO UPDATE SET
  "completedCount" = counterparty_trader_stats."completedCount" + EXCLUDED."completedCount",
  "paidCount" = counterparty_trader_stats."paidCount" + EXCLUDED."paidCount",
  "paidAmount" = counterparty_trader_stats."paidAmount" + EXCLUDED."paidAmount",
  "lastPaidAt" = GREATEST(counterparty_trader_stats."lastPaidAt", EXCLUDED."lastPaidAt"),
  "lastDealAt" = GREATEST(counterparty_trader_stats."lastDealAt", EXCLUDED."lastDealAt"),
  "updatedAt" = now()`;

const ADD_TO_TRADER_DAY = `INSERT INTO counterparty_trader_daily_volumes ("counterpartyId", "traderUserId", "day", "paidCount", "paidAmount")
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT ("counterpartyId", "traderUserId", "day") DO UPDATE SET
  "paidCount" = counterparty_trader_daily_volumes."paidCount" + EXCLUDED."paidCount",
  "paidAmount" = counterparty_trader_daily_volumes."paidAmount" + EXCLUDED."paidAmount",
  "updatedAt" = now()`;

const NOTHING = '0';

const ADD_REQUESTS_TO_DAY = `INSERT INTO counterparty_daily_requests ("counterpartyId", "day", "requestCount")
VALUES ($1, $2, $3)
ON CONFLICT ("counterpartyId", "day") DO UPDATE SET
  "requestCount" = counterparty_daily_requests."requestCount" + EXCLUDED."requestCount",
  "updatedAt" = now()`;

const SET_CLIENT_TOTALS = `UPDATE counterparties AS counterparty SET
  "dealCount" = source."dealCount",
  "completedCount" = source."completedCount",
  "paidCount" = source."paidCount",
  "disputeCount" = source."disputeCount",
  "paidAmount" = source."paidAmount",
  "lastDepositAt" = source."lastDepositAt",
  "updatedAt" = now()
FROM unnest($1::int[], $2::int[], $3::int[], $4::int[], $5::int[], $6::numeric[], $7::timestamptz[])
  AS source(id, "dealCount", "completedCount", "paidCount", "disputeCount", "paidAmount", "lastDepositAt")
WHERE counterparty.id = source.id`;

const INSERT_CLIENT_DAYS = `INSERT INTO counterparty_daily_volumes ("counterpartyId", "day", "paidCount", "paidAmount")
SELECT * FROM unnest($1::int[], $2::date[], $3::int[], $4::numeric[])`;

const INSERT_TRADER_TOTALS = `INSERT INTO counterparty_trader_stats ("counterpartyId", "traderUserId", "completedCount", "paidCount", "paidAmount", "lastPaidAt", "lastDealAt")
SELECT * FROM unnest($1::int[], $2::uuid[], $3::int[], $4::int[], $5::numeric[], $6::timestamptz[], $7::timestamptz[])`;

const INSERT_TRADER_DAYS = `INSERT INTO counterparty_trader_daily_volumes ("counterpartyId", "traderUserId", "day", "paidCount", "paidAmount")
SELECT * FROM unnest($1::int[], $2::uuid[], $3::date[], $4::int[], $5::numeric[])`;

const SET_CLIENT_REQUESTS = `UPDATE counterparties AS counterparty SET
  "requestCount" = source."requestCount",
  "lastRequestAt" = source."lastRequestAt",
  "updatedAt" = now()
FROM unnest($1::int[], $2::int[], $3::timestamptz[])
  AS source(id, "requestCount", "lastRequestAt")
WHERE counterparty.id = source.id`;

const INSERT_CLIENT_REQUEST_DAYS = `INSERT INTO counterparty_daily_requests ("counterpartyId", "day", "requestCount")
SELECT * FROM unnest($1::int[], $2::date[], $3::int[])`;

const BULK_BATCH_ROWS = 5000;

const DEAL_COUNTERS_LOCK = 'counterparty_deal_counters';
const REQUEST_COUNTERS_LOCK = 'counterparty_request_counters';
const LOCK_SHARED = 'SELECT pg_advisory_xact_lock_shared(hashtext($1))';
const LOCK_EXCLUSIVE = 'SELECT pg_advisory_xact_lock(hashtext($1))';

const instantOrNull = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

const batchesOf = <T>(rows: readonly T[]): T[][] =>
  Array.from({ length: Math.ceil(rows.length / BULK_BATCH_ROWS) }, (_, index) =>
    rows.slice(index * BULK_BATCH_ROWS, (index + 1) * BULK_BATCH_ROWS),
  );

@Injectable()
export class CounterpartyStatsService {
  constructor(private readonly config: ConfigService) {}

  async recordDealCreatedWithin(
    manager: EntityManager,
    counterpartyId: number,
    deal: { traderUserId: string | null; createdAt: Date },
  ): Promise<void> {
    await this.lockDealCountersWithin(manager, 'shared');
    await manager
      .createQueryBuilder()
      .update(Counterparty)
      .set({ dealCount: () => '"dealCount" + 1' })
      .where('id = :counterpartyId', { counterpartyId })
      .execute();

    if (deal.traderUserId === null) return;

    await manager.query(ADD_TO_TRADER, [
      counterpartyId,
      deal.traderUserId,
      0,
      0,
      NOTHING,
      null,
      deal.createdAt,
    ]);
  }

  async recordDisputeWithin(
    manager: EntityManager,
    counterpartyId: number,
  ): Promise<void> {
    await this.lockDealCountersWithin(manager, 'shared');
    await manager
      .createQueryBuilder()
      .update(Counterparty)
      .set({ disputeCount: () => '"disputeCount" + 1' })
      .where('id = :counterpartyId', { counterpartyId })
      .execute();
  }

  async recordCompletedWithin(
    manager: EntityManager,
    counterpartyId: number,
    outcome: CounterpartyDealOutcome,
  ): Promise<void> {
    await this.lockDealCountersWithin(manager, 'shared');
    if (!outcome.paid) {
      await manager
        .createQueryBuilder()
        .update(Counterparty)
        .set({ completedCount: () => '"completedCount" + 1' })
        .where('id = :counterpartyId', { counterpartyId })
        .execute();
      if (outcome.traderUserId !== null) {
        await manager.query(ADD_TO_TRADER, [
          counterpartyId,
          outcome.traderUserId,
          1,
          0,
          NOTHING,
          null,
          null,
        ]);
      }
      return;
    }

    const amount = formatFiat(outcome.amountFiat);
    await manager
      .createQueryBuilder()
      .update(Counterparty)
      .set({
        completedCount: () => '"completedCount" + 1',
        paidCount: () => '"paidCount" + 1',
        paidAmount: () => '"paidAmount" + :amount',
        lastDepositAt: () => 'GREATEST("lastDepositAt", :resolvedAt)',
      })
      .where('id = :counterpartyId', { counterpartyId })
      .setParameters({ amount, resolvedAt: outcome.resolvedAt })
      .execute();
    await manager.query(ADD_TO_DAY, [
      counterpartyId,
      this.dayOf(outcome.resolvedAt),
      1,
      amount,
    ]);
    await this.addPaidToTraderWithin(manager, counterpartyId, {
      traderUserId: outcome.traderUserId,
      completed: 1,
      paid: 1,
      amount,
      resolvedAt: outcome.resolvedAt,
    });
  }

  async recordDisputePaidWithin(
    manager: EntityManager,
    counterpartyId: number,
    outcome: {
      newlyPaid: boolean;
      amountFiat: Fiat;
      resolvedAt: Date;
      traderUserId: string | null;
    },
  ): Promise<void> {
    await this.lockDealCountersWithin(manager, 'shared');
    const amount = formatFiat(outcome.amountFiat);
    const newlyPaid = outcome.newlyPaid ? 1 : 0;

    await manager
      .createQueryBuilder()
      .update(Counterparty)
      .set({
        paidCount: () => '"paidCount" + :newlyPaid',
        paidAmount: () => '"paidAmount" + :amount',
        lastDepositAt: () => 'GREATEST("lastDepositAt", :resolvedAt)',
      })
      .where('id = :counterpartyId', { counterpartyId })
      .setParameters({ newlyPaid, amount, resolvedAt: outcome.resolvedAt })
      .execute();
    await manager.query(ADD_TO_DAY, [
      counterpartyId,
      this.dayOf(outcome.resolvedAt),
      newlyPaid,
      amount,
    ]);
    await this.addPaidToTraderWithin(manager, counterpartyId, {
      traderUserId: outcome.traderUserId,
      completed: 0,
      paid: newlyPaid,
      amount,
      resolvedAt: outcome.resolvedAt,
    });
  }

  async replaceTraderStatsWithin(
    manager: EntityManager,
    totals: readonly CounterpartyTraderTotals[],
    days: readonly CounterpartyTraderDayVolume[],
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .delete()
      .from(CounterpartyTraderStats)
      .execute();
    await manager
      .createQueryBuilder()
      .delete()
      .from(CounterpartyTraderDailyVolume)
      .execute();

    for (const batch of batchesOf(totals)) {
      await manager.query(INSERT_TRADER_TOTALS, [
        batch.map((row) => row.counterpartyId),
        batch.map((row) => row.traderUserId),
        batch.map((row) => row.completedCount),
        batch.map((row) => row.paidCount),
        batch.map((row) => formatFiat(row.paidAmount)),
        batch.map((row) => instantOrNull(row.lastPaidAt)),
        batch.map((row) => instantOrNull(row.lastDealAt)),
      ]);
    }
    for (const batch of batchesOf(days)) {
      await manager.query(INSERT_TRADER_DAYS, [
        batch.map((day) => day.counterpartyId),
        batch.map((day) => day.traderUserId),
        batch.map((day) => day.day),
        batch.map((day) => day.paidCount),
        batch.map((day) => formatFiat(day.paidAmount)),
      ]);
    }
  }

  private async addPaidToTraderWithin(
    manager: EntityManager,
    counterpartyId: number,
    paid: {
      traderUserId: string | null;
      completed: number;
      paid: number;
      amount: string;
      resolvedAt: Date;
    },
  ): Promise<void> {
    if (paid.traderUserId === null) return;

    await manager.query(ADD_TO_TRADER, [
      counterpartyId,
      paid.traderUserId,
      paid.completed,
      paid.paid,
      paid.amount,
      paid.resolvedAt,
      null,
    ]);
    await manager.query(ADD_TO_TRADER_DAY, [
      counterpartyId,
      paid.traderUserId,
      this.dayOf(paid.resolvedAt),
      paid.paid,
      paid.amount,
    ]);
  }

  async replaceAllWithin(
    manager: EntityManager,
    totals: readonly CounterpartyStatsTotals[],
    days: readonly CounterpartyDayVolume[],
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(Counterparty)
      .set({
        dealCount: 0,
        completedCount: 0,
        paidCount: 0,
        disputeCount: 0,
        paidAmount: () => '0',
        lastDepositAt: null,
      })
      .execute();
    await manager
      .createQueryBuilder()
      .delete()
      .from(CounterpartyDailyVolume)
      .execute();

    for (const batch of batchesOf(totals)) {
      await manager.query(SET_CLIENT_TOTALS, [
        batch.map((row) => row.counterpartyId),
        batch.map((row) => row.dealCount),
        batch.map((row) => row.completedCount),
        batch.map((row) => row.paidCount),
        batch.map((row) => row.disputeCount),
        batch.map((row) => formatFiat(row.paidAmount)),
        batch.map((row) => instantOrNull(row.lastDepositAt)),
      ]);
    }
    for (const batch of batchesOf(days)) {
      await manager.query(INSERT_CLIENT_DAYS, [
        batch.map((day) => day.counterpartyId),
        batch.map((day) => day.day),
        batch.map((day) => day.paidCount),
        batch.map((day) => formatFiat(day.paidAmount)),
      ]);
    }
  }

  async lockDealCountersWithin(
    manager: EntityManager,
    mode: 'shared' | 'exclusive',
  ): Promise<void> {
    await manager.query(mode === 'shared' ? LOCK_SHARED : LOCK_EXCLUSIVE, [
      DEAL_COUNTERS_LOCK,
    ]);
  }

  async lockRequestCountersWithin(
    manager: EntityManager,
    mode: 'shared' | 'exclusive',
  ): Promise<void> {
    await manager.query(mode === 'shared' ? LOCK_SHARED : LOCK_EXCLUSIVE, [
      REQUEST_COUNTERS_LOCK,
    ]);
  }

  async recordRequestWithin(
    manager: EntityManager,
    counterpartyId: number,
    receivedAt: Date,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(Counterparty)
      .set({
        requestCount: () => '"requestCount" + 1',
        lastRequestAt: () =>
          'GREATEST("lastRequestAt", CAST(:receivedAt AS timestamptz))',
      })
      .where('id = :counterpartyId', { counterpartyId })
      .setParameter('receivedAt', receivedAt)
      .execute();
    await manager.query(ADD_REQUESTS_TO_DAY, [
      counterpartyId,
      this.dayOf(receivedAt),
      1,
    ]);
  }

  async replaceRequestsWithin(
    manager: EntityManager,
    totals: readonly CounterpartyRequestTotals[],
    days: readonly CounterpartyDayRequests[],
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(Counterparty)
      .set({ requestCount: 0, lastRequestAt: null })
      .execute();
    await manager
      .createQueryBuilder()
      .delete()
      .from(CounterpartyDailyRequest)
      .execute();

    for (const batch of batchesOf(totals)) {
      await manager.query(SET_CLIENT_REQUESTS, [
        batch.map((row) => row.counterpartyId),
        batch.map((row) => row.requestCount),
        batch.map((row) => instantOrNull(row.lastRequestAt)),
      ]);
    }
    for (const batch of batchesOf(days)) {
      await manager.query(INSERT_CLIENT_REQUEST_DAYS, [
        batch.map((day) => day.counterpartyId),
        batch.map((day) => day.day),
        batch.map((day) => day.requestCount),
      ]);
    }
  }

  private dayOf(instant: Date): string {
    return calendarDateIn(
      instant,
      this.config.get<string>('BUSINESS_TIMEZONE'),
    );
  }
}
