import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { addCalendarDays } from '../../common/utils/add-calendar-days';
import { calendarDateIn } from '../../common/utils/calendar-date-in';
import { toCrypto } from '../../common/utils/to-crypto';
import { zonedMidnight } from '../../common/utils/zoned-midnight';
import { Transaction } from '../entities/transaction.entity';
import { DailyAmount } from '../types/daily-amount';
import { MerchantDashboardTotals } from '../types/merchant-dashboard-totals';
import { MerchantPayInStats } from '../types/merchant-pay-in-stats';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';

const SUCCESSFUL = [
  TransactionStatus.Success,
  TransactionStatus.SuccessChanged,
];

@Injectable()
export class MerchantStatsService {
  constructor(
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
  ) {}

  async payInStats(
    merchantId: string,
    from: Date,
    to: Date,
  ): Promise<MerchantPayInStats> {
    const row = await this.transactions
      .createQueryBuilder('transaction')
      .select(
        'COUNT(*) FILTER (WHERE transaction.createdAt >= :from AND transaction.createdAt < :to)',
        'total',
      )
      .addSelect(
        'COUNT(*) FILTER (WHERE transaction.createdAt >= :from AND transaction.createdAt < :to AND transaction.status IN (:...statuses))',
        'successful',
      )
      .addSelect(
        'COALESCE(SUM(transaction.amountCrypto) FILTER (WHERE transaction.resolvedAt >= :from AND transaction.resolvedAt < :to AND transaction.status IN (:...statuses)), 0)',
        'turnover',
      )
      .addSelect(
        'COUNT(*) FILTER (WHERE transaction.resolvedAt >= :from AND transaction.resolvedAt < :to AND transaction.status IN (:...statuses))',
        'turnoverCount',
      )
      .where('transaction.merchantId = :merchantId', { merchantId })
      .andWhere('transaction.kind = :kind', { kind: TransactionKind.PayIn })
      .setParameters({ from, to, statuses: SUCCESSFUL })
      .getRawOne<{
        total: string;
        successful: string;
        turnover: string;
        turnoverCount: string;
      }>();

    return {
      total: Number(row?.total ?? 0),
      successful: Number(row?.successful ?? 0),
      turnover: toCrypto(row?.turnover ?? 0),
      turnoverCount: Number(row?.turnoverCount ?? 0),
    };
  }

  async dashboardTotals(
    merchantId: string,
    from: Date | null,
    to: Date,
  ): Promise<MerchantDashboardTotals> {
    const payIn = `transaction.kind = '${TransactionKind.PayIn}'`;
    const query = this.transactions
      .createQueryBuilder('transaction')
      .select('COALESCE(SUM(transaction.amountCrypto), 0)', 'turnover')
      .addSelect(
        `COALESCE(SUM(transaction.merchantAmount) FILTER (WHERE ${payIn}), 0)`,
        'creditedPayIn',
      )
      .addSelect(
        `COALESCE(SUM(transaction.merchantCommission) FILTER (WHERE ${payIn}), 0)`,
        'payInCommission',
      )
      .addSelect(`COUNT(*) FILTER (WHERE ${payIn})`, 'successfulPayInCount')
      .addSelect(
        `COALESCE(SUM(transaction.amountCrypto) FILTER (WHERE ${payIn}), 0)`,
        'successfulPayInAmount',
      )
      .where('transaction.merchantId = :merchantId', { merchantId })
      .andWhere('transaction.status IN (:...statuses)', {
        statuses: SUCCESSFUL,
      })
      .andWhere('transaction.resolvedAt < :to', { to });

    if (from) query.andWhere('transaction.resolvedAt >= :from', { from });

    const row = await query.getRawOne<Record<string, string>>();

    return {
      turnover: toCrypto(row?.turnover ?? 0),
      creditedPayIn: toCrypto(row?.creditedPayIn ?? 0),
      payInCommission: toCrypto(row?.payInCommission ?? 0),
      successfulPayInCount: Number(row?.successfulPayInCount ?? 0),
      successfulPayInAmount: toCrypto(row?.successfulPayInAmount ?? 0),
    };
  }

  async turnoverSeries(
    merchantId: string,
    days: number,
    timeZone: string,
    now = new Date(),
  ): Promise<DailyAmount[]> {
    const today = calendarDateIn(now, timeZone);
    const first = addCalendarDays(today, 1 - days);
    const rows = await this.transactions
      .createQueryBuilder('transaction')
      .select(
        "to_char(transaction.resolvedAt AT TIME ZONE :timeZone, 'YYYY-MM-DD')",
        'day',
      )
      .addSelect('SUM(transaction.amountCrypto)', 'amount')
      .where('transaction.merchantId = :merchantId', { merchantId })
      .andWhere('transaction.status IN (:...statuses)', {
        statuses: SUCCESSFUL,
      })
      .andWhere('transaction.resolvedAt >= :from', {
        from: zonedMidnight(first, timeZone),
      })
      .andWhere('transaction.resolvedAt < :to', {
        to: zonedMidnight(addCalendarDays(today, 1), timeZone),
      })
      .setParameter('timeZone', timeZone)
      .groupBy('day')
      .getRawMany<{ day: string; amount: string }>();
    const byDay = new Map(rows.map((row) => [row.day, row.amount]));

    return Array.from({ length: days }, (_, index) => {
      const day = addCalendarDays(first, index);

      return { day, amount: toCrypto(byDay.get(day) ?? 0) };
    });
  }
}
