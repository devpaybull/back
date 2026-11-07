import { SortOrder } from '../../common/enums/sort-order.enum';
import { DisputeStatus } from './dispute-status.enum';

export interface DisputeListQuery {
  page: number;
  limit: number;
  sortOrder: SortOrder;
  statuses?: DisputeStatus[];
  transactionId?: string;
  traderUserId?: string;
}
