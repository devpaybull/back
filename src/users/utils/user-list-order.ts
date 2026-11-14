import { FindOptionsOrder } from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { sortDirection } from '../../common/utils/sort-direction';
import { User } from '../entities/user.entity';
import { TradingSortField } from '../types/trading-sort-field';
import { UserSortField } from '../types/user-sort-field.enum';

export const userListOrder = (
  sortBy: Exclude<UserSortField, TradingSortField>,
  sortOrder: SortOrder,
): FindOptionsOrder<User> => {
  const direction = sortDirection(sortOrder);

  switch (sortBy) {
    case UserSortField.Id:
      return { id: direction };
    case UserSortField.CreatedAt:
      return { createdAt: direction, id: direction };
    case UserSortField.Role:
      return { role: direction, id: direction };
    case UserSortField.Status:
      return { status: direction, id: direction };
    case UserSortField.Email:
      return { email: direction, id: direction };
  }
};
