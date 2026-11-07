import { SortOrder } from '../../common/enums/sort-order.enum';
import { BankDetailsStatus } from './bank-details-status.enum';
import { BankDetailsType } from './bank-details-type.enum';
import { BankDetailsSortField } from './bank-details-sort-field';

export interface BankDetailsListQuery {
  page: number;
  limit: number;
  search?: string;
  sortBy: BankDetailsSortField;
  sortOrder: SortOrder;
  userId?: string;
  bankId?: number;
  type?: BankDetailsType;
  active?: boolean;
  banned?: boolean;
  status?: BankDetailsStatus;
  tagId?: number;
}
