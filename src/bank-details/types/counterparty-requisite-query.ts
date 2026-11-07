import { SortOrder } from '../../common/enums/sort-order.enum';
import { BankDetailsType } from './bank-details-type.enum';

export interface CounterpartyRequisiteQuery {
  page: number;
  limit: number;
  search?: string;
  type?: BankDetailsType;
  sortOrder: SortOrder;
}
