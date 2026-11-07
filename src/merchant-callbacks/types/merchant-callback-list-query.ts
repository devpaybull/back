import { SortOrder } from '../../common/enums/sort-order.enum';
import { MerchantCallbackStatus } from './merchant-callback-status.enum';

export interface MerchantCallbackListQuery {
  page: number;
  limit: number;
  sortOrder: SortOrder;
  statuses?: MerchantCallbackStatus[];
  createdFrom?: Date;
  createdTo?: Date;
  search?: string;
}
