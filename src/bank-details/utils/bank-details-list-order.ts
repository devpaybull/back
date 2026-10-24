import { FindOptionsOrder } from 'typeorm';
import { sortDirection } from '../../common/utils/sort-direction';
import { BankDetails } from '../entities/bank-details.entity';
import { BankDetailsListQuery } from '../types/bank-details-list-query';
import { BankDetailsSortField } from '../types/bank-details-sort-field';

export const bankDetailsListOrder = (
  query: BankDetailsListQuery,
): FindOptionsOrder<BankDetails> => {
  const direction = sortDirection(query.sortOrder);

  switch (query.sortBy) {
    case BankDetailsSortField.Id:
      return { id: direction };
    case BankDetailsSortField.CreatedAt:
      return { createdAt: direction, id: direction };
    case BankDetailsSortField.MinAmount:
      return { minAmount: direction, id: direction };
    case BankDetailsSortField.MaxAmount:
      return { maxAmount: direction, id: direction };
    case BankDetailsSortField.DailyLimit:
      return { dailyLimit: direction, id: direction };
  }
};
