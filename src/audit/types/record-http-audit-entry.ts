export interface RecordHttpAuditEntry {
  actorUserId: string | null;
  impersonatorUserId: string | null;
  targetUserId: string | null;
  action: string;
  method: string;
  path: string;
  params: Record<string, unknown> | null;
  statusCode: number;
  ip: string | null;
  userAgent: string | null;
  login: string | null;
  body: unknown;
}
