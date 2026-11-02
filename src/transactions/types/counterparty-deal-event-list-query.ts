import { SortOrder } from '../../common/enums/sort-order.enum';

export interface CounterpartyDealEventListQuery {
  page: number;
  limit: number;
  sortOrder: SortOrder;
}
