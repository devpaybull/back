import { SortOrder } from '../../common/enums/sort-order.enum';
import { CounterpartySortField } from './counterparty-sort-field.enum';

export interface CounterpartyListQuery {
  page: number;
  limit: number;
  search?: string;
  sortBy: CounterpartySortField;
  sortOrder: SortOrder;
  merchantId?: string;
}
