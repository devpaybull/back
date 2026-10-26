import { SortOrder } from '../../common/enums/sort-order.enum';
import { AccountTransactionSortField } from './account-transaction-sort-field.enum';
import { AccountTransactionStatus } from './account-transaction-status.enum';
import { AccountTransactionStatusReason } from './account-transaction-status-reason.enum';
import { AccountTransactionType } from './account-transaction-type.enum';

export interface AccountTransactionListQuery {
  type: AccountTransactionType;
  page: number;
  limit: number;
  sortOrder?: SortOrder;
  sortBy?: AccountTransactionSortField;
  status?: AccountTransactionStatus[];
  statusReason?: AccountTransactionStatusReason;
  userId?: string;
  createdFrom?: Date;
  createdTo?: Date;
  search?: string;
  matchedUserIds?: string[];
  userRanks?: Map<string, number>;
}
