import { SortOrder } from '../../common/enums/sort-order.enum';

export interface RequisiteEventListQuery {
  page: number;
  limit: number;
  sortOrder: SortOrder;
}
