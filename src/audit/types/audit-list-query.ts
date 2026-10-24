import { SortOrder } from '../../common/enums/sort-order.enum';
import { AuditSortField } from './audit-sort-field.enum';

export interface AuditListQuery {
  page: number;
  limit: number;
  sortBy: AuditSortField;
  sortOrder: SortOrder;
  targetUserId: string;
}
