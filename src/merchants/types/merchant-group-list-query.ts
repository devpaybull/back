import { SortOrder } from '../../common/enums/sort-order.enum';
import { MerchantGroupSortField } from './merchant-group-sort-field.enum';

export interface MerchantGroupListQuery {
  page: number;
  limit: number;
  search?: string;
  sortBy: MerchantGroupSortField;
  sortOrder: SortOrder;
}
