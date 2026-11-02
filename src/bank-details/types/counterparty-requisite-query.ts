import { SortOrder } from '../../common/enums/sort-order.enum';
import { TransactionType } from '../../common/enums/transaction-type.enum';

export interface CounterpartyRequisiteQuery {
  page: number;
  limit: number;
  search?: string;
  type?: TransactionType;
  sortOrder: SortOrder;
}
