import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { Repository } from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { Page, toPage } from '../../common/types/page';
import { TransactionStatusEvent } from '../entities/transaction-status-event.entity';
import { Transaction } from '../entities/transaction.entity';
import { MerchantDealFilter } from '../types/merchant-deal-filter';
import { MerchantDealListQuery } from '../types/merchant-deal-list-query';
import { MerchantDealStatusCounts } from '../types/merchant-deal-status-counts';
import { TransactionSortField } from '../types/transaction-sort-field.enum';
import { TransactionStatus } from '../types/transaction-status.enum';
import { transactionListOrder } from '../utils/transaction-list-order';
import { transactionListWhere } from '../utils/transaction-list-where';

const zeroCounts = (): MerchantDealStatusCounts =>
  Object.fromEntries(
    Object.values(TransactionStatus).map((status) => [status, 0]),
  ) as MerchantDealStatusCounts;

@Injectable()
export class MerchantDealsService {
  constructor(
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
    @InjectRepository(TransactionStatusEvent)
    private readonly events: Repository<TransactionStatusEvent>,
  ) {}

  async list(
    merchantId: string,
    query: MerchantDealListQuery,
  ): Promise<Page<Transaction>> {
    const where = transactionListWhere({ ...query, merchantId });
    const reference = query.reference;

    return toPage(
      await this.transactions.findAndCount({
        where:
          reference === undefined
            ? where
            : [
                { ...where, merchantTransactionId: reference },
                ...(isUUID(reference) ? [{ ...where, id: reference }] : []),
              ],
        order: transactionListOrder({ ...query, merchantId }),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }

  async export(
    merchantId: string,
    filter: MerchantDealFilter,
    maxRows: number,
  ): Promise<Transaction[]> {
    const query = {
      ...filter,
      merchantId,
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
    merchantId: string,
    filter: MerchantDealFilter = {},
  ): Promise<MerchantDealStatusCounts> {
    const rows = await this.transactions
      .createQueryBuilder('transaction')
      .select('transaction.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .setFindOptions({
        where: transactionListWhere({
          ...filter,
          statuses: undefined,
          merchantId,
          page: 1,
          limit: 1,
          sortBy: TransactionSortField.CreatedAt,
          sortOrder: SortOrder.Desc,
        }),
      })
      .groupBy('transaction.status')
      .getRawMany<{ status: TransactionStatus; count: string }>();
    const counts = zeroCounts();

    for (const row of rows) counts[row.status] = Number(row.count);

    return counts;
  }

  async findOwn(merchantId: string, id: string): Promise<Transaction> {
    const deal = await this.transactions.findOne({ where: { id, merchantId } });

    if (!deal) throw new NotFoundException('Deal not found');

    return deal;
  }

  statusHistory(transactionId: string): Promise<TransactionStatusEvent[]> {
    return this.events.find({
      where: { transactionId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }
}
