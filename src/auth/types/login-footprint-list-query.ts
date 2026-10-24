import { SortOrder } from '../../common/enums/sort-order.enum';

export interface LoginFootprintListQuery {
  page: number;
  limit: number;
  sortOrder: SortOrder;
}
