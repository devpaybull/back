import { SortOrder } from '../../common/enums/sort-order.enum';
import { MerchantDealFilter } from './merchant-deal-filter';
import { TransactionSortField } from './transaction-sort-field.enum';

export interface MerchantDealListQuery extends MerchantDealFilter {
  page: number;
  limit: number;
  sortBy: TransactionSortField;
  sortOrder: SortOrder;
  reference?: string;
}
