import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { calendarDateIn } from '../../common/utils/calendar-date-in';
import { formatFiat } from '../../common/utils/format-fiat';
import { CounterpartyDailyVolume } from '../entities/counterparty-daily-volume.entity';
import { Counterparty } from '../entities/counterparty.entity';
import { CounterpartyDayVolume } from '../types/counterparty-day-volume';
import { CounterpartyDealOutcome } from '../types/counterparty-deal-outcome';
import { CounterpartyStatsTotals } from '../types/counterparty-stats-totals';

const ADD_TO_DAY = `INSERT INTO counterparty_daily_volumes ("counterpartyId", "day", "paidCount", "paidAmount")
VALUES ($1, $2, $3, $4)
ON CONFLICT ("counterpartyId", "day") DO UPDATE SET
  "paidCount" = counterparty_daily_volumes."paidCount" + EXCLUDED."paidCount",
  "paidAmount" = counterparty_daily_volumes."paidAmount" + EXCLUDED."paidAmount",
  "updatedAt" = now()`;

@Injectable()
export class CounterpartyStatsService {
  constructor(private readonly config: ConfigService) {}

  async recordDealCreatedWithin(
    manager: EntityManager,
    counterpartyId: number,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(Counterparty)
      .set({ dealCount: () => '"dealCount" + 1' })
      .where('id = :counterpartyId', { counterpartyId })
      .execute();
  }

  async recordDisputeWithin(
    manager: EntityManager,
    counterpartyId: number,
  ): Promise<void> {
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
    if (!outcome.paid) {
      await manager
        .createQueryBuilder()
        .update(Counterparty)
        .set({ completedCount: () => '"completedCount" + 1' })
        .where('id = :counterpartyId', { counterpartyId })
        .execute();
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

    for (const row of totals) {
      await manager
        .createQueryBuilder()
        .update(Counterparty)
        .set({
          dealCount: row.dealCount,
          completedCount: row.completedCount,
          paidCount: row.paidCount,
          disputeCount: row.disputeCount,
          paidAmount: () => ':paidAmount',
          lastDepositAt: row.lastDepositAt,
        })
        .where('id = :counterpartyId', { counterpartyId: row.counterpartyId })
        .setParameter('paidAmount', formatFiat(row.paidAmount))
        .execute();
    }
    for (const day of days) {
      await manager.query(ADD_TO_DAY, [
        day.counterpartyId,
        day.day,
        day.paidCount,
        formatFiat(day.paidAmount),
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
