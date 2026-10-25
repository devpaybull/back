import { SortOrder } from '../../common/enums/sort-order.enum';
import { AuditSortField } from './audit-sort-field.enum';
import { AuditSource } from './audit-source.enum';

export interface AuditListQuery {
  page: number;
  limit: number;
  sortBy: AuditSortField;
  sortOrder: SortOrder;
  targetUserId?: string;
  actorUserId?: string;
  impersonatorUserId?: string;
  action?: string;
  actions?: readonly string[];
  source?: AuditSource;
  statusCode?: number;
}
