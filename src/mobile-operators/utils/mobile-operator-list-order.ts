import { FindOptionsOrder } from 'typeorm';
import { sortDirection } from '../../common/utils/sort-direction';
import { MobileOperator } from '../entities/mobile-operator.entity';
import { MobileOperatorListQuery } from '../types/mobile-operator-list-query';
import { MobileOperatorSortField } from '../types/mobile-operator-sort-field';

export const mobileOperatorListOrder = (
  query: MobileOperatorListQuery,
): FindOptionsOrder<MobileOperator> => {
  const direction = sortDirection(query.sortOrder);

  switch (query.sortBy) {
    case MobileOperatorSortField.Id:
      return { id: direction };
    case MobileOperatorSortField.CreatedAt:
      return { createdAt: direction, id: direction };
    case MobileOperatorSortField.Name:
      return { name: direction, id: direction };
    case MobileOperatorSortField.Code:
      return { code: direction, id: direction };
  }
};
