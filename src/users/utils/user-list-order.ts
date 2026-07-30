import { FindOptionsOrder } from 'typeorm';
import { sortDirection } from '../../common/utils/sort-direction';
import { User } from '../entities/user.entity';
import { UserListQuery } from '../types/user-list-query';
import { UserSortField } from '../types/user-sort-field.enum';

export const userListOrder = (query: UserListQuery): FindOptionsOrder<User> => {
  const direction = sortDirection(query.sortOrder);

  switch (query.sortBy) {
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
