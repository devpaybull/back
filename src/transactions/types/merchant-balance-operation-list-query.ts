import { SortOrder } from '../../common/enums/sort-order.enum';
import { PageRequest } from '../../common/types/page';
import { MerchantBalanceOperationFilter } from './merchant-balance-operation-filter';

export interface MerchantBalanceOperationListQuery
  extends MerchantBalanceOperationFilter, PageRequest {
  sortOrder: SortOrder;
}
