import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { InstantRange } from '../../common/types/instant-range';
import { addCalendarDays } from '../../common/utils/add-calendar-days';
import { calendarDateIn } from '../../common/utils/calendar-date-in';
import { toCrypto } from '../../common/utils/to-crypto';
import { toFiat } from '../../common/utils/to-fiat';
import { zonedMidnight } from '../../common/utils/zoned-midnight';
import { SelectionAttempt } from '../entities/selection-attempt.entity';
import { TransactionDispute } from '../entities/transaction-dispute.entity';
import { Transaction } from '../entities/transaction.entity';
import { DisputeStatus } from '../types/dispute-status.enum';
import { SelectionOutcome } from '../types/selection-outcome.enum';
import { TraderStatsBucket } from '../types/trader-stats-bucket';
import { TraderStatsDay } from '../types/trader-stats-day';
import { TraderStatsFilter } from '../types/trader-stats-filter';
import { TraderStatsSummary } from '../types/trader-stats-summary';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';

const DAILY_WINDOW_DAYS = 14;

const PAID = `deal.status IN ('${TransactionStatus.Success}', '${TransactionStatus.SuccessChanged}')`;
const CANCELED = `deal.status = '${TransactionStatus.Canceled}'`;
const DISPUTED = `EXISTS (SELECT 1 FROM transaction_status_events disputed WHERE disputed."transactionId" = deal.id AND disputed."toStatus" = '${TransactionStatus.Dispute}')`;
const DECIDED_DISPUTES = [DisputeStatus.Accepted, DisputeStatus.Rejected];

const BUCKETS: readonly { label: string; upTo: number | null }[] = [
  { label: '1-999', upTo: null },
  { label: '1000-2000', upTo: 2000 },
  { label: '2001-5000', upTo: 5000 },
  { label: '5001-10000', upTo: 10000 },
  { label: '10000+', upTo: null },
];
const FIRST_BUCKET_BELOW = 1000;

const BUCKET_OF = [
  `WHEN deal.amountFiat < ${FIRST_BUCKET_BELOW} THEN 0`,
  ...BUCKETS.flatMap((bucket, index) =>
    bucket.upTo === null
      ? []
      : [`WHEN deal.amountFiat <= ${bucket.upTo} THEN ${index}`],
  ),
  `ELSE ${BUCKETS.length - 1}`,
].join(' ');

const secondsOrNull = (value: string | null | undefined): number | null =>
  value === null || value === undefined ? null : Math.round(Number(value));

@Injectable()
export class TraderStatsService {
  constructor(
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
    @InjectRepository(SelectionAttempt)
    private readonly attempts: Repository<SelectionAttempt>,
    @InjectRepository(TransactionDispute)
    private readonly disputes: Repository<TransactionDispute>,
  ) {}

  async summary(
    traderUserId: string,
    range: InstantRange,
    filter: TraderStatsFilter,
  ): Promise<TraderStatsSummary> {
    const [issue, created, resolved, payouts, disputes] = await Promise.all([
      this.issueCounts(traderUserId, range, filter),
      this.ownDeals(traderUserId, filter)
        .select(`COUNT(*) FILTER (WHERE ${PAID})`, 'paid')
        .addSelect(`COUNT(*) FILTER (WHERE ${CANCELED})`, 'canceled')
        .andWhere(
          this.within('deal.createdAt', range),
          this.rangeParameters(range),
        )
        .getRawOne<{ paid: string; canceled: string }>(),
      this.ownDeals(traderUserId, filter)
        .select('COUNT(*)', 'successCount')
        .addSelect('COALESCE(SUM(deal.amountFiat), 0)', 'turnover')
        .addSelect('COALESCE(SUM(deal.amountCrypto), 0)', 'volumeCrypto')
        .addSelect('COALESCE(SUM(deal.traderCommission), 0)', 'income')
        .addSelect(
          `AVG(EXTRACT(EPOCH FROM deal.resolvedAt - deal.createdAt)) FILTER (WHERE deal.kind = '${TransactionKind.PayIn}')`,
          'depositSeconds',
        )
        .andWhere(PAID)
        .andWhere(
          this.within('deal.resolvedAt', range),
          this.rangeParameters(range),
        )
        .getRawOne<{
          successCount: string;
          turnover: string;
          volumeCrypto: string;
          income: string;
          depositSeconds: string | null;
        }>(),
      this.ownDeals(traderUserId, filter)
        .select(
          'AVG(EXTRACT(EPOCH FROM deal.payoutCompletedAt - deal.payoutTakenAt))',
          'payoutSeconds',
        )
        .andWhere('deal.kind = :payOut', { payOut: TransactionKind.PayOut })
        .andWhere('deal.payoutTakenAt IS NOT NULL')
        .andWhere(
          this.within('deal.payoutCompletedAt', range),
          this.rangeParameters(range),
        )
        .getRawOne<{ payoutSeconds: string | null }>(),
      this.applyFilter(
        this.disputes
          .createQueryBuilder('dispute')
          .innerJoin('dispute.transaction', 'deal')
          .select(
            'AVG(EXTRACT(EPOCH FROM dispute.resolvedAt - dispute.openedAt))',
            'disputeSeconds',
          )
          .where('deal.traderUserId = :traderUserId', { traderUserId })
          .andWhere('dispute.status IN (:...decided)', {
            decided: DECIDED_DISPUTES,
          })
          .andWhere(
            this.within('dispute.resolvedAt', range),
            this.rangeParameters(range),
          ),
        filter,
      ).getRawOne<{ disputeSeconds: string | null }>(),
    ]);

    return {
      ...issue,
      paid: Number(created?.paid ?? 0),
      canceled: Number(created?.canceled ?? 0),
      successCount: Number(resolved?.successCount ?? 0),
      turnover: toFiat(resolved?.turnover ?? 0),
      volumeCrypto: toCrypto(resolved?.volumeCrypto ?? 0),
      income: toCrypto(resolved?.income ?? 0),
      depositSeconds: secondsOrNull(resolved?.depositSeconds),
      payoutSeconds: secondsOrNull(payouts?.payoutSeconds),
      disputeSeconds: secondsOrNull(disputes?.disputeSeconds),
    };
  }

  async daily(
    traderUserId: string,
    filter: TraderStatsFilter,
    timeZone: string,
    now = new Date(),
  ): Promise<TraderStatsDay[]> {
    const today = calendarDateIn(now, timeZone);
    const first = addCalendarDays(today, 1 - DAILY_WINDOW_DAYS);
    const range = {
      from: zonedMidnight(first, timeZone),
      to: zonedMidnight(addCalendarDays(today, 1), timeZone),
    };
    const dayOf = (column: string) =>
      `to_char(${column} AT TIME ZONE :timeZone, 'YYYY-MM-DD')`;

    const [money, counts] = await Promise.all([
      this.ownDeals(traderUserId, filter)
        .select(dayOf('deal.resolvedAt'), 'day')
        .addSelect('COALESCE(SUM(deal.traderCommission), 0)', 'income')
        .addSelect('COALESCE(SUM(deal.amountFiat), 0)', 'turnover')
        .andWhere(PAID)
        .andWhere(
          this.within('deal.resolvedAt', range),
          this.rangeParameters(range),
        )
        .setParameter('timeZone', timeZone)
        .groupBy('day')
        .getRawMany<{ day: string; income: string; turnover: string }>(),
      this.ownDeals(traderUserId, filter)
        .select(dayOf('deal.createdAt'), 'day')
        .addSelect('COUNT(*)', 'created')
        .addSelect(`COUNT(*) FILTER (WHERE ${PAID})`, 'paid')
        .addSelect(`COUNT(*) FILTER (WHERE ${CANCELED})`, 'canceled')
        .addSelect(`COUNT(*) FILTER (WHERE ${DISPUTED})`, 'disputed')
        .andWhere(
          this.within('deal.createdAt', range),
          this.rangeParameters(range),
        )
        .setParameter('timeZone', timeZone)
        .groupBy('day')
        .getRawMany<{
          day: string;
          created: string;
          paid: string;
          canceled: string;
          disputed: string;
        }>(),
    ]);
    const moneyByDay = new Map(money.map((row) => [row.day, row]));
    const countsByDay = new Map(counts.map((row) => [row.day, row]));

    return Array.from({ length: DAILY_WINDOW_DAYS }, (_, index) => {
      const day = addCalendarDays(first, index);
      const sums = moneyByDay.get(day);
      const tally = countsByDay.get(day);

      return {
        day,
        income: toCrypto(sums?.income ?? 0),
        turnover: toFiat(sums?.turnover ?? 0),
        created: Number(tally?.created ?? 0),
        paid: Number(tally?.paid ?? 0),
        canceled: Number(tally?.canceled ?? 0),
        disputed: Number(tally?.disputed ?? 0),
      };
    });
  }

  async buckets(
    traderUserId: string,
    range: InstantRange,
    filter: TraderStatsFilter,
  ): Promise<TraderStatsBucket[]> {
    const rows = await this.ownDeals(traderUserId, filter)
      .select(`CASE ${BUCKET_OF} END`, 'bucket')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(deal.amountCrypto), 0)', 'volumeCrypto')
      .addSelect('COALESCE(SUM(deal.amountFiat), 0)', 'volumeFiat')
      .andWhere(PAID)
      .andWhere(
        this.within('deal.resolvedAt', range),
        this.rangeParameters(range),
      )
      .groupBy('bucket')
      .getRawMany<{
        bucket: number | string;
        count: string;
        volumeCrypto: string;
        volumeFiat: string;
      }>();
    const byBucket = new Map(rows.map((row) => [Number(row.bucket), row]));

    return BUCKETS.map((bucket, index) => {
      const row = byBucket.get(index);

      return {
        label: bucket.label,
        count: Number(row?.count ?? 0),
        volumeCrypto: toCrypto(row?.volumeCrypto ?? 0),
        volumeFiat: toFiat(row?.volumeFiat ?? 0),
      };
    });
  }

  private async issueCounts(
    traderUserId: string,
    range: InstantRange,
    filter: TraderStatsFilter,
  ): Promise<{ issued: number; skipped: number }> {
    if (filter.kind === TransactionKind.PayOut)
      return { issued: 0, skipped: 0 };

    const query = this.attempts
      .createQueryBuilder('attempt')
      .select(
        `COUNT(*) FILTER (WHERE attempt.outcome = '${SelectionOutcome.Issued}')`,
        'issued',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE attempt.outcome = '${SelectionOutcome.Skipped}')`,
        'skipped',
      )
      .where('attempt.traderUserId = :traderUserId', { traderUserId })
      .andWhere(
        this.within('attempt.createdAt', range),
        this.rangeParameters(range),
      );

    if (filter.method) {
      query.andWhere('attempt.method = :method', { method: filter.method });
    }
    if (filter.bankDetailsId) {
      query.andWhere('attempt.bankDetailsId = :bankDetailsId', {
        bankDetailsId: filter.bankDetailsId,
      });
    }

    const row = await query.getRawOne<{ issued: string; skipped: string }>();

    return {
      issued: Number(row?.issued ?? 0),
      skipped: Number(row?.skipped ?? 0),
    };
  }

  private ownDeals(
    traderUserId: string,
    filter: TraderStatsFilter,
  ): SelectQueryBuilder<Transaction> {
    return this.applyFilter(
      this.transactions
        .createQueryBuilder('deal')
        .where('deal.traderUserId = :traderUserId', { traderUserId }),
      filter,
    );
  }

  private applyFilter<T extends object>(
    query: SelectQueryBuilder<T>,
    filter: TraderStatsFilter,
  ): SelectQueryBuilder<T> {
    if (filter.kind) query.andWhere('deal.kind = :kind', { kind: filter.kind });
    if (filter.method) {
      query.andWhere('deal.method = :method', { method: filter.method });
    }
    if (filter.bankDetailsId) {
      query.andWhere('deal.bankDetailsId = :bankDetailsId', {
        bankDetailsId: filter.bankDetailsId,
      });
    }

    return query;
  }

  private within(column: string, range: InstantRange): string {
    return range.from
      ? `${column} >= :rangeFrom AND ${column} < :rangeTo`
      : `${column} < :rangeTo`;
  }

  private rangeParameters(range: InstantRange): Record<string, Date> {
    return range.from
      ? { rangeFrom: range.from, rangeTo: range.to }
      : { rangeTo: range.to };
  }
}
