export interface RecordAuditEntry {
  actorUserId: string;
  targetUserId?: string | null;
  action: string;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}
