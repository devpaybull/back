import { AuditSource } from './audit-source.enum';

export interface AuditRecord {
  id: number;
  source: AuditSource;
  actorUserId: string | null;
  impersonatorUserId: string | null;
  targetUserId: string | null;
  action: string;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  method: string | null;
  path: string | null;
  params: Record<string, unknown> | null;
  statusCode: number | null;
  ip: string | null;
  userAgent: string | null;
  login: string | null;
  body: unknown;
  createdAt: Date;
}
