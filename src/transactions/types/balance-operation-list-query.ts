import { SortOrder } from '../../common/enums/sort-order.enum';
import { PageRequest } from '../../common/types/page';
import { BalanceOperationFilter } from './balance-operation-filter';

export interface BalanceOperationListQuery
  extends BalanceOperationFilter, PageRequest {
  sortOrder: SortOrder;
}
