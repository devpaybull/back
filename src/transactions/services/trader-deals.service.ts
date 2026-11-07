import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { Page, toPage } from '../../common/types/page';
import { Transaction } from '../entities/transaction.entity';
import { MerchantDealStatusCounts } from '../types/merchant-deal-status-counts';
import { TraderDealFilter } from '../types/trader-deal-filter';
import { TraderDealListQuery } from '../types/trader-deal-list-query';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionSortField } from '../types/transaction-sort-field.enum';
import { TransactionStatus } from '../types/transaction-status.enum';
import { transactionListOrder } from '../utils/transaction-list-order';
import { transactionListWhere } from '../utils/transaction-list-where';

const zeroCounts = (): MerchantDealStatusCounts =>
  Object.fromEntries(
    Object.values(TransactionStatus).map((status) => [status, 0]),
  ) as MerchantDealStatusCounts;

const matchesNothing = (filter: TraderDealFilter): boolean =>
  filter.bankDetailsIds?.length === 0 ||
  filter.merchantIds?.length === 0 ||
  filter.counterpartyIds?.length === 0;

@Injectable()
export class TraderDealsService {
  constructor(
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
  ) {}

  async list(
    traderUserId: string,
    query: TraderDealListQuery,
  ): Promise<Page<Transaction>> {
    if (matchesNothing(query)) return toPage([[], 0], query);

    const scoped = {
      ...query,
      traderUserId,
      kind: TransactionKind.PayIn,
    };

    return toPage(
      await this.transactions.findAndCount({
        where: transactionListWhere(scoped),
        order: transactionListOrder(scoped),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }

  async export(
    traderUserId: string,
    filter: TraderDealFilter,
    maxRows: number,
  ): Promise<Transaction[]> {
    if (matchesNothing(filter)) return [];

    const query = {
      ...filter,
      traderUserId,
      kind: TransactionKind.PayIn,
      page: 1,
      limit: maxRows,
      sortBy: TransactionSortField.CreatedAt,
      sortOrder: SortOrder.Desc,
    };
    const rows = await this.transactions.find({
      where: transactionListWhere(query),
      order: transactionListOrder(query),
      take: maxRows + 1,
    });

    if (rows.length > maxRows) {
      throw new BadRequestException(
        `More than ${maxRows} deals match; narrow the period or the filters`,
      );
    }

    return rows;
  }

  async statusCounts(
    traderUserId: string,
    filter: TraderDealFilter,
  ): Promise<MerchantDealStatusCounts> {
    const counts = zeroCounts();

    if (matchesNothing(filter)) return counts;

    const rows = await this.transactions
      .createQueryBuilder('transaction')
      .select('transaction.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .setFindOptions({
        where: transactionListWhere({
          ...filter,
          statuses: undefined,
          traderUserId,
          kind: TransactionKind.PayIn,
          page: 1,
          limit: 1,
          sortBy: TransactionSortField.CreatedAt,
          sortOrder: SortOrder.Desc,
        }),
      })
      .groupBy('transaction.status')
      .getRawMany<{ status: TransactionStatus; count: string }>();

    for (const row of rows) counts[row.status] = Number(row.count);

    return counts;
  }

  async findOwn(traderUserId: string, id: string): Promise<Transaction> {
    const deal = await this.transactions.findOne({
      where: { id, traderUserId, kind: TransactionKind.PayIn },
    });

    if (!deal) throw new NotFoundException('Deal not found');

    return deal;
  }
}
