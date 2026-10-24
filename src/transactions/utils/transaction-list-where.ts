import { FindOptionsWhere } from 'typeorm';
import { Transaction } from '../entities/transaction.entity';
import { TransactionListQuery } from '../types/transaction-list-query';

export const transactionListWhere = (
  query: TransactionListQuery,
): FindOptionsWhere<Transaction> => {
  const where: FindOptionsWhere<Transaction> = {};

  if (query.kind !== undefined) where.kind = query.kind;
  if (query.status !== undefined) where.status = query.status;
  if (query.method !== undefined) where.method = query.method;
  if (query.traderUserId !== undefined) where.traderUserId = query.traderUserId;
  if (query.merchantId !== undefined) where.merchantId = query.merchantId;

  return where;
};
