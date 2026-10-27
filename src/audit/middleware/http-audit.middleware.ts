import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { NextFunction, Response } from 'express';
import { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { AuditService } from '../services/audit.service';
import { RecordHttpAuditEntry } from '../types/record-http-audit-entry';

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SECRET_KEY = /password|totp|code|token|secret/i;
const REDACTED = '[REDACTED]';
const ADMIN_USER_ROUTE = /^\/admin\/users\/:id(\/|$)/;
const REDACTED_BODY_FIELDS: Record<string, readonly string[]> = {
  '/admin/merchants/:id/ip-addresses': ['ip'],
};

const redactRouteFields = (route: string, body: unknown): unknown => {
  const fields = REDACTED_BODY_FIELDS[route];

  if (!fields || body === null || typeof body !== 'object') return body;

  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [
      key,
      fields.includes(key) ? REDACTED : value,
    ]),
  );
};

const redactSecrets = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SECRET_KEY.test(key) ? REDACTED : redactSecrets(nested),
    ]),
  );
};

@Injectable()
export class HttpAuditMiddleware implements NestMiddleware {
  private readonly logger = new Logger(HttpAuditMiddleware.name);

  constructor(private readonly audit: AuditService) {}

  use(request: AuthenticatedRequest, response: Response, next: NextFunction) {
    if (!READ_ONLY_METHODS.has(request.method)) {
      const middlewareRoute: unknown = request.route;

      response.once('finish', () =>
        this.write(request, response, middlewareRoute),
      );
    }

    next();
  }

  private write(
    request: AuthenticatedRequest,
    response: Response,
    middlewareRoute: unknown,
  ): void {
    try {
      const entry =
        request.route === middlewareRoute
          ? null
          : this.entryOf(request, response);

      if (!entry) return;

      this.audit.recordHttp(entry).catch((error: Error) => this.fail(error));
    } catch (error) {
      this.fail(error as Error);
    }
  }

  private entryOf(
    request: AuthenticatedRequest,
    response: Response,
  ): RecordHttpAuditEntry | null {
    const route: unknown = request.route?.path;

    if (typeof route !== 'string') return null;

    const params: Record<string, unknown> = { ...(request.params ?? {}) };
    const targetId = params.id;
    const body: unknown = request.body ?? null;
    const anonymousLogin =
      !request.user && typeof (body as { login?: unknown })?.login === 'string'
        ? (body as { login: string }).login
        : null;

    return {
      actorUserId: request.user?.id ?? null,
      impersonatorUserId: request.user?.impersonatedBy ?? null,
      targetUserId:
        ADMIN_USER_ROUTE.test(route) &&
        typeof targetId === 'string' &&
        isUUID(targetId)
          ? targetId
          : null,
      action: `${request.method} ${route}`,
      method: request.method,
      path: request.originalUrl.split('?')[0],
      params: Object.keys(params).length > 0 ? params : null,
      statusCode: response.statusCode,
      ip: request.ip ?? null,
      userAgent: request.get('user-agent') ?? null,
      login: anonymousLogin,
      body: redactSecrets(redactRouteFields(route, body)),
    };
  }

  private fail(error: Error): void {
    this.logger.error(`HTTP audit write failed: ${error.message}`, error.stack);
  }
}
