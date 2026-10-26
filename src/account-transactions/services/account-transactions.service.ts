import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Brackets, DataSource, In, SelectQueryBuilder } from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { Page, toPage } from '../../common/types/page';
import { escapeLikePattern } from '../../common/utils/escape-like-pattern';
import { roundCrypto } from '../../common/utils/round-crypto';
import { toCrypto } from '../../common/utils/to-crypto';
import { AccountTransaction } from '../entities/account-transaction.entity';
import { DepositTransfer } from '../entities/deposit-transfer.entity';
import { WithdrawalAttempt } from '../entities/withdrawal-attempt.entity';
import { AccountTransactionListQuery } from '../types/account-transaction-list-query';
import { AccountTransactionSortField } from '../types/account-transaction-sort-field.enum';
import { AccountTransactionStats } from '../types/account-transaction-stats';
import { AccountTransactionStatus } from '../types/account-transaction-status.enum';
import { AccountTransactionStatusReason } from '../types/account-transaction-status-reason.enum';
import { AccountTransactionType } from '../types/account-transaction-type.enum';
import { FinanceHistoryQuery } from '../types/finance-history-query';

const DAY_MS = 86_400_000;
const FINAL_STATUSES = [
  AccountTransactionStatus.Completed,
  AccountTransactionStatus.Failed,
  AccountTransactionStatus.Canceled,
];

@Injectable()
export class AccountTransactionsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(
    query: AccountTransactionListQuery,
  ): Promise<Page<AccountTransaction>> {
    const direction = query.sortOrder === SortOrder.Asc ? 'ASC' : 'DESC';

    if (query.sortBy === AccountTransactionSortField.User) {
      return this.listByUser(query, direction);
    }

    const column = {
      [AccountTransactionSortField.Id]: 'entry.id',
      [AccountTransactionSortField.CreatedAt]: 'entry.createdAt',
      [AccountTransactionSortField.Amount]: 'entry.amount',
      [AccountTransactionSortField.Fee]: 'entry.fee',
    }[query.sortBy ?? AccountTransactionSortField.CreatedAt];
    const builder = this.filtered(query)
      .orderBy(
        column,
        direction,
        direction === 'ASC' ? 'NULLS LAST' : 'NULLS FIRST',
      )
      .addOrderBy('entry.id', direction)
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    return toPage(await builder.getManyAndCount(), query);
  }

  async userIdsOf(query: AccountTransactionListQuery): Promise<string[]> {
    const rows = await this.filtered(query)
      .select('entry.userId', 'userId')
      .distinct(true)
      .getRawMany<{ userId: string }>();

    return rows.map((row) => row.userId);
  }

  exportRows(
    query: Omit<AccountTransactionListQuery, 'page' | 'limit'>,
    cap: number,
  ): Promise<AccountTransaction[]> {
    return this.filtered({ ...query, page: 1, limit: cap })
      .orderBy('entry.createdAt', 'DESC')
      .addOrderBy('entry.id', 'DESC')
      .take(cap + 1)
      .getMany();
  }

  async transfersOf(ids: number[]): Promise<Map<number, DepositTransfer[]>> {
    const rows = ids.length
      ? await this.dataSource.getRepository(DepositTransfer).find({
          where: { accountTransactionId: In(ids) },
          order: { id: 'ASC' },
        })
      : [];

    return this.groupBy(rows, (row) => row.accountTransactionId);
  }

  async attemptsOf(ids: number[]): Promise<Map<number, WithdrawalAttempt[]>> {
    const rows = ids.length
      ? await this.dataSource.getRepository(WithdrawalAttempt).find({
          where: { accountTransactionId: In(ids) },
          order: { id: 'ASC' },
        })
      : [];

    return this.groupBy(rows, (row) => row.accountTransactionId);
  }

  async stats(
    type: AccountTransactionType,
    now: Date,
    staleMinutes: number,
  ): Promise<AccountTransactionStats> {
    const since = new Date(now.getTime() - DAY_MS);
    const staleBefore = new Date(now.getTime() - staleMinutes * 60_000);
    const amountColumn =
      type === AccountTransactionType.Deposit
        ? 'entry.creditedAmount'
        : 'entry.amount';
    const repository = this.dataSource.getRepository(AccountTransaction);
    const [grouped, totals] = await Promise.all([
      repository
        .createQueryBuilder('entry')
        .select('entry.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('entry.type = :type', { type })
        .groupBy('entry.status')
        .getRawMany<{ status: AccountTransactionStatus; count: string }>(),
      repository
        .createQueryBuilder('entry')
        .select(
          `COUNT(*) FILTER (WHERE entry.status = :completed AND entry.completedAt > :since)`,
          'completedCount',
        )
        .addSelect(
          `COALESCE(SUM(${amountColumn}) FILTER (WHERE entry.status = :completed AND entry.completedAt > :since), 0)`,
          'completedAmount',
        )
        .addSelect(
          `COUNT(*) FILTER (WHERE entry.status IN (:...final) AND entry.updatedAt > :since)`,
          'finished',
        )
        .addSelect(
          `COUNT(*) FILTER (WHERE entry.status = :processing AND entry.updatedAt < :staleBefore)`,
          'stale',
        )
        .addSelect(
          `COUNT(*) FILTER (WHERE entry.statusReason = :belowMinimum AND entry.status = :processing)`,
          'belowMinimum',
        )
        .where('entry.type = :type', { type })
        .setParameters({
          completed: AccountTransactionStatus.Completed,
          processing: AccountTransactionStatus.Processing,
          belowMinimum: AccountTransactionStatusReason.BelowMinimum,
          final: FINAL_STATUSES,
          since,
          staleBefore,
        })
        .getRawOne<{
          completedCount: string;
          completedAmount: string;
          finished: string;
          stale: string;
          belowMinimum: string;
        }>(),
    ]);
    const byStatus = Object.fromEntries(
      Object.values(AccountTransactionStatus).map((status) => [status, 0]),
    ) as Record<AccountTransactionStatus, number>;

    for (const row of grouped) byStatus[row.status] = Number(row.count);

    return {
      byStatus,
      belowMinimum: Number(totals?.belowMinimum ?? 0),
      completedLast24h: {
        count: Number(totals?.completedCount ?? 0),
        amount: roundCrypto(toCrypto(String(totals?.completedAmount ?? '0'))),
      },
      finishedLast24h: Number(totals?.finished ?? 0),
      staleProcessing: Number(totals?.stale ?? 0),
    };
  }

  async history(query: FinanceHistoryQuery): Promise<Page<AccountTransaction>> {
    const direction = query.sortOrder === SortOrder.Asc ? 'ASC' : 'DESC';
    const builder = this.historyFiltered(query)
      .orderBy(
        query.sortBy === 'amount' ? 'entry.amount' : 'entry.createdAt',
        direction,
      )
      .addOrderBy('entry.id', direction)
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    return toPage(await builder.getManyAndCount(), query);
  }

  async historyCounts(
    query: Omit<FinanceHistoryQuery, 'page' | 'limit' | 'type'>,
  ): Promise<Record<AccountTransactionType, number>> {
    const rows = await this.historyFiltered({ ...query, page: 1, limit: 1 })
      .select('entry.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .groupBy('entry.type')
      .getRawMany<{ type: AccountTransactionType; count: string }>();
    const counts = Object.fromEntries(
      Object.values(AccountTransactionType).map((type) => [type, 0]),
    ) as Record<AccountTransactionType, number>;

    for (const row of rows) counts[row.type] = Number(row.count);

    return counts;
  }

  private historyFiltered(
    query: FinanceHistoryQuery,
  ): SelectQueryBuilder<AccountTransaction> {
    const builder = this.dataSource
      .getRepository(AccountTransaction)
      .createQueryBuilder('entry')
      .where(
        new Brackets((where) =>
          where
            .where('entry.userId = :me', { me: query.userId })
            .orWhere('entry.counterpartyUserId = :me', { me: query.userId }),
        ),
      );

    if (query.type?.length)
      builder.andWhere('entry.type IN (:...types)', { types: query.type });

    if (query.status?.length) {
      builder.andWhere('entry.status IN (:...statuses)', {
        statuses: query.status,
      });
    }

    if (query.from)
      builder.andWhere('entry.createdAt >= :from', { from: query.from });

    if (query.to) builder.andWhere('entry.createdAt < :to', { to: query.to });

    return builder;
  }

  private async listByUser(
    query: AccountTransactionListQuery,
    direction: 'ASC' | 'DESC',
  ): Promise<Page<AccountTransaction>> {
    const all = await this.filtered(query)
      .select(['entry.id', 'entry.userId'])
      .getMany();
    const ranks = query.userRanks ?? new Map<string, number>();
    const sign = direction === 'ASC' ? 1 : -1;
    const ordered = all.sort(
      (left, right) =>
        sign *
        ((ranks.get(left.userId) ?? 0) - (ranks.get(right.userId) ?? 0) ||
          left.id - right.id),
    );
    const pageIds = ordered
      .slice((query.page - 1) * query.limit, query.page * query.limit)
      .map((row) => row.id);
    const rows = pageIds.length
      ? await this.dataSource
          .getRepository(AccountTransaction)
          .find({ where: { id: In(pageIds) } })
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));

    return toPage(
      [pageIds.map((id) => byId.get(id)!).filter(Boolean), all.length],
      query,
    );
  }

  private filtered(
    query: AccountTransactionListQuery,
  ): SelectQueryBuilder<AccountTransaction> {
    const builder = this.dataSource
      .getRepository(AccountTransaction)
      .createQueryBuilder('entry')
      .where('entry.type = :type', { type: query.type });

    if (query.status?.length) {
      builder.andWhere('entry.status IN (:...statuses)', {
        statuses: query.status,
      });
    }

    if (query.statusReason) {
      builder.andWhere('entry.statusReason = :reason', {
        reason: query.statusReason,
      });
    }

    if (query.userId)
      builder.andWhere('entry.userId = :userId', { userId: query.userId });

    if (query.createdFrom) {
      builder.andWhere('entry.createdAt >= :createdFrom', {
        createdFrom: query.createdFrom,
      });
    }

    if (query.createdTo) {
      builder.andWhere('entry.createdAt <= :createdTo', {
        createdTo: query.createdTo,
      });
    }

    const term = query.search?.trim();

    if (term) {
      const like = `%${escapeLikePattern(term)}%`;
      builder.andWhere(
        new Brackets((where) => {
          if (/^\d+$/.test(term) && Number(term) <= 2147483647) {
            where.orWhere('entry.id = :searchId', { searchId: Number(term) });
          }

          if (query.matchedUserIds?.length) {
            where.orWhere('entry.userId IN (:...matchedUserIds)', {
              matchedUserIds: query.matchedUserIds,
            });
          }

          where
            .orWhere('entry.address ILIKE :like', { like })
            .orWhere('entry.txHash ILIKE :like', { like })
            .orWhere(
              `EXISTS (SELECT 1 FROM deposit_transfers t WHERE t."accountTransactionId" = entry.id AND t."txHash" ILIKE :like)`,
              { like },
            )
            .orWhere(
              `EXISTS (SELECT 1 FROM withdrawal_attempts a WHERE a."accountTransactionId" = entry.id AND a."txHash" ILIKE :like)`,
              { like },
            );
        }),
      );
    }

    return builder;
  }

  private groupBy<T>(rows: T[], keyOf: (row: T) => number): Map<number, T[]> {
    const grouped = new Map<number, T[]>();

    for (const row of rows) {
      const key = keyOf(row);
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }

    return grouped;
  }
}
