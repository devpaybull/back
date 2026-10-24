import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { AuditLog } from '../entities/audit-log.entity';
import { AuditRecord } from '../types/audit-record';
import { AuditSource } from '../types/audit-source.enum';
import { VictoriaAuditQuery } from '../types/victoria-audit-query';

const REQUEST_TIMEOUT_MS = 10_000;
const FILTERED_FIELDS = [
  'targetUserId',
  'actorUserId',
  'impersonatorUserId',
  'action',
  'source',
  'statusCode',
] as const;
const ONE_ROW_PER_AUDIT_ID = 'sort by (auditId) partition by (auditId) limit 1';

type VictoriaLine = Record<string, string | undefined>;

@Injectable()
export class VictoriaLogsService {
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.baseUrl = (config.get<string>('VICTORIA_LOGS_URL') ?? '').replace(
      /\/+$/,
      '',
    );
  }

  get enabled(): boolean {
    return this.baseUrl !== '';
  }

  async insert(rows: AuditLog[]): Promise<void> {
    const params = new URLSearchParams({
      _stream_fields: 'source',
      _time_field: 'createdAt',
      _msg_field: 'message',
    });
    const body = rows.map((row) => JSON.stringify(toLine(row))).join('\n');

    await this.request(`/insert/jsonline?${params.toString()}`, {
      headers: { 'Content-Type': 'application/stream+json' },
      body: `${body}\n`,
    });
  }

  async find(query: VictoriaAuditQuery): Promise<[AuditRecord[], number]> {
    const filter = toFilter(query);
    const [counted] = await this.select(
      `${filter} | stats count_uniq(auditId) total`,
    );
    const total = Number(counted?.total ?? 0);

    if (query.take <= 0) return [[], total];

    const direction = query.sortOrder === SortOrder.Asc ? '' : ' desc';
    const lines = await this.select(
      `${filter} | ${ONE_ROW_PER_AUDIT_ID} | sort by (auditId${direction}) offset ${query.skip} limit ${query.take}`,
    );

    return [lines.map(fromLine), total];
  }

  private async select(logsql: string): Promise<VictoriaLine[]> {
    const text = await this.request('/select/logsql/query', {
      body: new URLSearchParams({ query: logsql }),
    });

    return text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as VictoriaLine);
  }

  private async request(
    path: string,
    init: { headers?: Record<string, string>; body: string | URLSearchParams },
  ): Promise<string> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: init.headers,
      body: init.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `VictoriaLogs answered ${response.status} on ${path}: ${text}`,
      );
    }

    return text;
  }
}

const toActionsFilter = (actions: readonly string[]): string =>
  `action:in(${actions.map((action) => JSON.stringify(action)).join(',')})`;

const toFilter = (query: VictoriaAuditQuery): string =>
  [
    query.belowId === null ? 'auditId:>0' : `auditId:<${query.belowId}`,
    ...FILTERED_FIELDS.filter((field) => query[field] !== undefined).map(
      (field) => `${field}:=${JSON.stringify(String(query[field]))}`,
    ),
    ...(query.action === undefined && query.actions
      ? [toActionsFilter(query.actions)]
      : []),
  ].join(' ');

const toJson = (value: unknown): string | null =>
  value === null || value === undefined ? null : JSON.stringify(value);

const fromJson = <T>(value: string | undefined): T | null =>
  value === undefined || value === '' ? null : (JSON.parse(value) as T);

const orNull = (value: string | undefined): string | null =>
  value === undefined || value === '' ? null : value;

const toLine = (row: AuditLog): Record<string, unknown> => ({
  auditId: row.id,
  message: row.action,
  source: row.source,
  actorUserId: row.actorUserId,
  impersonatorUserId: row.impersonatorUserId,
  targetUserId: row.targetUserId,
  action: row.action,
  reason: row.reason,
  metadata: toJson(row.metadata),
  method: row.method,
  path: row.path,
  params: toJson(row.params),
  statusCode: row.statusCode,
  ip: row.ip,
  userAgent: row.userAgent,
  login: row.login,
  body: toJson(row.body),
  createdAt: new Date(row.createdAt).toISOString(),
  updatedAt: new Date(row.updatedAt).toISOString(),
});

const fromLine = (line: VictoriaLine): AuditRecord => ({
  id: Number(line.auditId),
  source: (orNull(line.source) as AuditSource) ?? AuditSource.Domain,
  actorUserId: orNull(line.actorUserId),
  impersonatorUserId: orNull(line.impersonatorUserId),
  targetUserId: orNull(line.targetUserId),
  action: orNull(line.action) ?? orNull(line._msg),
  reason: orNull(line.reason),
  metadata: fromJson(line.metadata),
  method: orNull(line.method),
  path: orNull(line.path),
  params: fromJson(line.params),
  statusCode: orNull(line.statusCode) === null ? null : Number(line.statusCode),
  ip: orNull(line.ip),
  userAgent: orNull(line.userAgent),
  login: orNull(line.login),
  body: fromJson(line.body),
  createdAt: new Date(line._time ?? line.createdAt),
});
