export interface RecordAuditEntry {
  actorUserId: string | null;
  impersonatorUserId?: string | null;
  targetUserId?: string | null;
  action: string;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}
