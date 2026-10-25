import { SortOrder } from '../../common/enums/sort-order.enum';
import { PageRequest } from '../../common/types/page';
import { DebtEventSortField } from './debt-event-sort-field.enum';

export interface DebtEventListQuery extends PageRequest {
  sortBy: DebtEventSortField;
  sortOrder: SortOrder;
}
