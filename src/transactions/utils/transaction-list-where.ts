import {
  Between,
  FindOperator,
  FindOptionsWhere,
  In,
  LessThanOrEqual,
  MoreThanOrEqual,
} from 'typeorm';
import { Transaction } from '../entities/transaction.entity';
import { TransactionListQuery } from '../types/transaction-list-query';

const inclusiveRange = <T>(
  from: T | undefined,
  to: T | undefined,
): FindOperator<T> | undefined => {
  if (from !== undefined && to !== undefined) return Between(from, to);
  if (from !== undefined) return MoreThanOrEqual(from);
  if (to !== undefined) return LessThanOrEqual(to);

  return undefined;
};

export const transactionListWhere = (
  query: TransactionListQuery,
): FindOptionsWhere<Transaction> => {
  const where: FindOptionsWhere<Transaction> = {};

  if (query.kind !== undefined) where.kind = query.kind;
  if (query.status !== undefined) where.status = query.status;
  if (query.method !== undefined) where.method = query.method;
  if (query.traderUserId !== undefined) where.traderUserId = query.traderUserId;
  if (query.merchantId !== undefined) where.merchantId = query.merchantId;

  const createdAt = inclusiveRange(query.createdFrom, query.createdTo);
  if (createdAt) where.createdAt = createdAt;

  const amountFiat = inclusiveRange(query.amountFrom, query.amountTo);
  if (amountFiat) where.amountFiat = amountFiat;

  if (query.bankDetailsIds !== undefined) {
    where.bankDetailsId = In(query.bankDetailsIds);
  }

  return where;
};
