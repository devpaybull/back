import { SortOrder } from '../../common/enums/sort-order.enum';
import { Crypto } from '../../common/types/crypto';
import { UserListFilter } from './user-list-filter';
import { UserSortField } from './user-sort-field.enum';

export interface UserListQuery extends UserListFilter {
  page: number;
  limit: number;
  sortBy: UserSortField;
  sortOrder: SortOrder;
  insurancePayInMinDefault?: Crypto;
}
