import { SortOrder } from '../../common/enums/sort-order.enum';
import { TransactionType } from '../../common/enums/transaction-type.enum';
import { BankDetailsSortField } from './bank-details-sort-field';

export interface BankDetailsListQuery {
  page: number;
  limit: number;
  search?: string;
  sortBy: BankDetailsSortField;
  sortOrder: SortOrder;
  userId?: string;
  bankId?: number;
  type?: TransactionType;
  active?: boolean;
  banned?: boolean;
}
