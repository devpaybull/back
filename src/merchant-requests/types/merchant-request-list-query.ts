import { SortOrder } from '../../common/enums/sort-order.enum';
import { MerchantRequestFilter } from './merchant-request-filter';
import { MerchantRequestSortField } from './merchant-request-sort-field.enum';

export interface MerchantRequestListQuery extends MerchantRequestFilter {
  page: number;
  limit: number;
  sortBy: MerchantRequestSortField;
  sortOrder: SortOrder;
  merchantRanks?: ReadonlyMap<string, number>;
}
