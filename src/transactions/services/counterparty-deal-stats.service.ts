import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { Page, toPage } from '../../common/types/page';
import { addCalendarDays } from '../../common/utils/add-calendar-days';
import { calendarDateIn } from '../../common/utils/calendar-date-in';
import { sortDirection } from '../../common/utils/sort-direction';
import { toFiat } from '../../common/utils/to-fiat';
import { zonedMidnight } from '../../common/utils/zoned-midnight';
import { CounterpartyStatsService } from '../../counterparties/services/counterparty-stats.service';
import { TransactionStatusEvent } from '../entities/transaction-status-event.entity';
import { Transaction } from '../entities/transaction.entity';
import { CounterpartyDealEventListQuery } from '../types/counterparty-deal-event-list-query';
import { CounterpartyDealStats } from '../types/counterparty-deal-stats';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';
import { COUNTERPARTY_STATS_METHOD_CODES } from '../utils/counterparty-stats-method-codes';

const PAID = `deal.status IN ('${TransactionStatus.Success}', '${TransactionStatus.SuccessChanged}')`;
const COMPLETED = `deal.status IN ('${TransactionStatus.Success}', '${TransactionStatus.SuccessChanged}', '${TransactionStatus.Canceled}')`;
const DISPUTED = `EXISTS (SELECT 1 FROM transaction_status_events disputed WHERE disputed."transactionId" = deal.id AND disputed."toStatus" = '${TransactionStatus.Dispute}')`;

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
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
    @InjectRepository(TransactionStatusEvent)
    private readonly events: Repository<TransactionStatusEvent>,
    private readonly counterpartyStats: CounterpartyStatsService,
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

  async rebuildCounterpartyStats(): Promise<void> {
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

    await this.dataSource.transaction((manager) =>
      this.counterpartyStats.replaceAllWithin(
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
      ),
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
