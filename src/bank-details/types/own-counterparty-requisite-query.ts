import { SortOrder } from '../../common/enums/sort-order.enum';

export interface OwnCounterpartyRequisiteQuery {
  page: number;
  limit: number;
  sortOrder: SortOrder;
  bankDetailsId?: string;
}
