import { TransactionType } from '../../common/enums/transaction-type.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { BankSortField } from './bank-sort-field';

export interface BankListQuery {
  page: number;
  limit: number;
  search?: string;
  sortBy: BankSortField;
  sortOrder: SortOrder;
  countryId?: number;
  currencyId?: number;
  transactionType?: TransactionType;
  active?: boolean;
  automatic?: boolean;
}
