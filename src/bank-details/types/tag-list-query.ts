import { SortOrder } from '../../common/enums/sort-order.enum';

export interface TagListQuery {
  page: number;
  limit: number;
  search?: string;
  sortOrder: SortOrder;
}
