import { AuditRecord } from '../../audit/types/audit-record';

export interface RequisiteHistoryEntry {
  record: AuditRecord;
  unread: boolean;
}
