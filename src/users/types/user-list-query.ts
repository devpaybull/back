import { Role } from '../../common/enums/role.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { UserSortField } from './user-sort-field.enum';
import { UserStatus } from './user-status.enum';

export interface UserListQuery {
  page: number;
  limit: number;
  search?: string;
  sortBy: UserSortField;
  sortOrder: SortOrder;
  role?: Role;
  status?: UserStatus;
}
