import { SortOrder } from '../../common/enums/sort-order.enum';
import { CounterpartyFilter } from './counterparty-filter';
import { CounterpartySortField } from './counterparty-sort-field.enum';

export interface CounterpartyListQuery extends CounterpartyFilter {
  page: number;
  limit: number;
  sortBy: CounterpartySortField;
  sortOrder: SortOrder;
}
