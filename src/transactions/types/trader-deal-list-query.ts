import { SortOrder } from '../../common/enums/sort-order.enum';
import { TraderDealFilter } from './trader-deal-filter';
import { TransactionSortField } from './transaction-sort-field.enum';

export interface TraderDealListQuery extends TraderDealFilter {
  page: number;
  limit: number;
  sortBy: TransactionSortField;
  sortOrder: SortOrder;
}
