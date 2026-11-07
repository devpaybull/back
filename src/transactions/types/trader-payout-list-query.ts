import { SortOrder } from '../../common/enums/sort-order.enum';
import { TraderPayoutFilter } from './trader-payout-filter';
import { TransactionSortField } from './transaction-sort-field.enum';

export interface TraderPayoutListQuery extends TraderPayoutFilter {
  page: number;
  limit: number;
  sortBy: TransactionSortField;
  sortOrder: SortOrder;
}
