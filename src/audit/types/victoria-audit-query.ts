import { SortOrder } from '../../common/enums/sort-order.enum';
import { AuditSource } from './audit-source.enum';

export interface VictoriaAuditQuery {
  belowId: number | null;
  sortOrder: SortOrder;
  skip: number;
  take: number;
  targetUserId?: string;
  actorUserId?: string;
  actorUserIdOrSystem?: string;
  impersonatorUserId?: string;
  action?: string;
  actions?: readonly string[];
  anyActorActions?: readonly string[];
  source?: AuditSource;
  statusCode?: number;
  createdAfter?: Date;
}
