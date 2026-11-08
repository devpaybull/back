import { SortOrder } from '../../common/enums/sort-order.enum';
import { TraderCounterpartySortField } from './trader-counterparty-sort-field.enum';

export interface TraderCounterpartyListQuery {
  page: number;
  limit: number;
  sortBy: TraderCounterpartySortField;
  sortOrder: SortOrder;
  hideInactive: boolean;
}
