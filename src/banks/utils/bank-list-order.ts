import { FindOptionsOrder } from 'typeorm';
import { sortDirection } from '../../common/utils/sort-direction';
import { Bank } from '../entities/bank.entity';
import { BankListQuery } from '../types/bank-list-query';
import { BankSortField } from '../types/bank-sort-field';

export const bankListOrder = (query: BankListQuery): FindOptionsOrder<Bank> => {
  const direction = sortDirection(query.sortOrder);

  switch (query.sortBy) {
    case BankSortField.Id:
      return { id: direction };
    case BankSortField.CreatedAt:
      return { createdAt: direction, id: direction };
    case BankSortField.Name:
      return { name: direction, id: direction };
    case BankSortField.BankId:
      return { bankId: direction, id: direction };
  }
};
