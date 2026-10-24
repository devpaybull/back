import { SortOrder } from '../../common/enums/sort-order.enum';
import { PageRequest } from '../../common/types/page';
import { DebtSortField } from './debt-sort-field.enum';
import { DebtStatus } from './debt-status.enum';

export interface DebtListQuery extends PageRequest {
  status?: DebtStatus;
  userId?: string;
  search?: string;
  sortBy: DebtSortField;
  sortOrder: SortOrder;
}
