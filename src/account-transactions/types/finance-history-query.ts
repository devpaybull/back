import { SortOrder } from '../../common/enums/sort-order.enum';
import { AccountTransactionStatus } from './account-transaction-status.enum';
import { AccountTransactionType } from './account-transaction-type.enum';

export interface FinanceHistoryQuery {
  userId: string;
  page: number;
  limit: number;
  sortOrder?: SortOrder;
  sortBy?: 'createdAt' | 'amount';
  type?: AccountTransactionType[];
  status?: AccountTransactionStatus[];
  from?: Date;
  to?: Date;
}
