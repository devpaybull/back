import { SortOrder } from '../enums/sort-order.enum';

export const sortDirection = (order: SortOrder): 'ASC' | 'DESC' =>
  order === SortOrder.Asc ? 'ASC' : 'DESC';
