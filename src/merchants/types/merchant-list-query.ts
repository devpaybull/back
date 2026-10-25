import { SortOrder } from '../../common/enums/sort-order.enum';
import { MerchantSortField } from './merchant-sort-field.enum';

export interface MerchantListQuery {
  page: number;
  limit: number;
  search?: string;
  sortBy: MerchantSortField;
  sortOrder: SortOrder;
}
