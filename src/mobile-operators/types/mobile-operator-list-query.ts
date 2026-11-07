import { SortOrder } from '../../common/enums/sort-order.enum';
import { MobileOperatorSortField } from './mobile-operator-sort-field';

export interface MobileOperatorListQuery {
  page: number;
  limit: number;
  search?: string;
  sortBy: MobileOperatorSortField;
  sortOrder: SortOrder;
  countryId?: number;
  active?: boolean;
}
