import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  FindOptionsWhere,
  In,
  IsNull,
  LessThanOrEqual,
  MoreThan,
  Not,
  Repository,
} from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { Crypto } from '../../common/types/crypto';
import { Page, toPage } from '../../common/types/page';
import { TraderMerchantExclusions } from '../../merchants/types/trader-pay-out-exclusions';
import { Transaction } from '../entities/transaction.entity';
import { MerchantDealStatusCounts } from '../types/merchant-deal-status-counts';
import { TraderPayoutFilter } from '../types/trader-payout-filter';
import { TraderPayoutListQuery } from '../types/trader-payout-list-query';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionSortField } from '../types/transaction-sort-field.enum';
import { TransactionStatus } from '../types/transaction-status.enum';
import { transactionListOrder } from '../utils/transaction-list-order';
import { transactionListWhere } from '../utils/transaction-list-where';
import { TRANSACTION_METHODS } from '../utils/transaction-methods';

const PAY_OUT_METHODS = TRANSACTION_METHODS.filter((method) =>
  (method.directions as readonly TransactionKind[]).includes(
    TransactionKind.PayOut,
  ),
).map((method) => method.code);

const zeroCounts = (): MerchantDealStatusCounts =>
  Object.fromEntries(
    Object.values(TransactionStatus).map((status) => [status, 0]),
  ) as MerchantDealStatusCounts;

@Injectable()
export class TraderPayoutsService {
  constructor(
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
  ) {}

  async pool(
    query: TraderPayoutListQuery,
    exclusions: TraderMerchantExclusions,
    insuranceRoom: Crypto | null,
    now: Date,
  ): Promise<Page<Transaction>> {
    if (query.merchantIds?.length === 0) return toPage([[], 0], query);

    const where = this.poolWhere(query, exclusions, insuranceRoom, now);

    if (where.length === 0) return toPage([[], 0], query);

    return toPage(
      await this.transactions.findAndCount({
        where,
        order: transactionListOrder(query),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }

  async list(
    traderUserId: string,
    query: TraderPayoutListQuery,
  ): Promise<Page<Transaction>> {
    if (query.merchantIds?.length === 0) return toPage([[], 0], query);

    const scoped = {
      ...query,
      traderUserId,
      kind: TransactionKind.PayOut,
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
    filter: TraderPayoutFilter,
    maxRows: number,
  ): Promise<Transaction[]> {
    if (filter.merchantIds?.length === 0) return [];

    const query = {
      ...filter,
      traderUserId,
      kind: TransactionKind.PayOut,
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
        `More than ${maxRows} pay-outs match; narrow the period or the filters`,
      );
    }

    return rows;
  }

  async statusCounts(
    traderUserId: string,
    filter: TraderPayoutFilter,
  ): Promise<MerchantDealStatusCounts> {
    const counts = zeroCounts();

    if (filter.merchantIds?.length === 0) return counts;

    const rows = await this.transactions
      .createQueryBuilder('transaction')
      .select('transaction.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .setFindOptions({
        where: transactionListWhere({
          ...filter,
          statuses: undefined,
          traderUserId,
          kind: TransactionKind.PayOut,
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
      where: { id, traderUserId, kind: TransactionKind.PayOut },
    });

    if (!deal) throw new NotFoundException('Pay-out not found');

    return deal;
  }

  private poolWhere(
    query: TraderPayoutListQuery,
    exclusions: TraderMerchantExclusions,
    insuranceRoom: Crypto | null,
    now: Date,
  ): FindOptionsWhere<Transaction>[] {
    const base: FindOptionsWhere<Transaction> = {
      ...transactionListWhere({ ...query, merchantIds: undefined }),
      kind: TransactionKind.PayOut,
      status: TransactionStatus.Pending,
      traderUserId: IsNull(),
      expiresAt: MoreThan(now),
      ...(insuranceRoom === null
        ? {}
        : { amountCrypto: LessThanOrEqual(insuranceRoom) }),
    };
    const methods = query.method
      ? PAY_OUT_METHODS.filter((code) => code === query.method)
      : PAY_OUT_METHODS;

    return methods.flatMap((method): FindOptionsWhere<Transaction>[] => {
      const attached = new Set(exclusions.attachedMerchantIds(method));
      const excluded = new Set([
        ...exclusions.switchedOffMerchantIds(method),
        ...exclusions.exclusiveMerchantIds.filter((id) => !attached.has(id)),
      ]);

      if (query.merchantIds) {
        const allowed = query.merchantIds.filter((id) => !excluded.has(id));

        return allowed.length
          ? [{ ...base, method, merchantId: In(allowed) }]
          : [];
      }

      return [
        {
          ...base,
          method,
          ...(excluded.size ? { merchantId: Not(In([...excluded])) } : {}),
        },
      ];
    });
  }
}
