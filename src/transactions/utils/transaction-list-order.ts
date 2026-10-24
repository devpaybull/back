import { FindOptionsOrder } from 'typeorm';
import { sortDirection } from '../../common/utils/sort-direction';
import { Transaction } from '../entities/transaction.entity';
import { TransactionListQuery } from '../types/transaction-list-query';
import { TransactionSortField } from '../types/transaction-sort-field.enum';

export const transactionListOrder = (
  query: TransactionListQuery,
): FindOptionsOrder<Transaction> => {
  const direction = sortDirection(query.sortOrder);

  switch (query.sortBy) {
    case TransactionSortField.Id:
      return { id: direction };
    case TransactionSortField.CreatedAt:
      return { createdAt: direction, id: direction };
    case TransactionSortField.ResolvedAt:
      return { resolvedAt: direction, id: direction };
    case TransactionSortField.AmountCrypto:
      return { amountCrypto: direction, id: direction };
  }
};
