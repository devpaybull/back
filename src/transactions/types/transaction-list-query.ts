import { Fiat } from '../../common/types/fiat';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { TransactionKind } from './transaction-kind.enum';
import { TransactionMethod } from './transaction-method';
import { TransactionSortField } from './transaction-sort-field.enum';
import { TransactionStatus } from './transaction-status.enum';

export interface TransactionListQuery {
  page: number;
  limit: number;
  sortBy: TransactionSortField;
  sortOrder: SortOrder;
  kind?: TransactionKind;
  status?: TransactionStatus;
  method?: TransactionMethod;
  traderUserId?: string;
  merchantId?: string;
  createdFrom?: Date;
  createdTo?: Date;
  amountFrom?: Fiat;
  amountTo?: Fiat;
  bankDetailsIds?: string[];
  merchantRanks?: ReadonlyMap<string, number>;
}
