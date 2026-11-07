import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { MerchantRequestsService } from '../../merchant-requests/services/merchant-requests.service';
import { MerchantApiRequest } from '../types/merchant-api-request';

const REQUEST_ID_HEADER = 'X-Request-Id';

const textOf = (body: unknown): string | null => {
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');

  return null;
};

@Injectable()
export class MerchantRequestLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger(MerchantRequestLogMiddleware.name);

  constructor(private readonly requests: MerchantRequestsService) {}

  use(request: MerchantApiRequest, response: Response, next: NextFunction) {
    const id = randomUUID();
    const receivedAt = new Date();
    const startedAt = performance.now();
    const ip = request.ip ?? null;
    const send = response.send.bind(response);
    let responseBody: string | null = null;

    request.requestId = id;
    response.setHeader(REQUEST_ID_HEADER, id);
    response.send = ((body?: unknown) => {
      responseBody = textOf(body) ?? responseBody;

      return send(body);
    }) as Response['send'];

    response.on('finish', () => {
      const merchant = request.apiMerchant;

      if (!merchant) return;

      this.requests
        .record({
          id,
          merchantId: merchant.merchantId,
          apiKeyId: merchant.apiKeyId,
          method: request.method,
          path: request.originalUrl,
          ip,
          requestHeaders: request.headers,
          requestBody: request.rawBody
            ? request.rawBody.toString('utf8')
            : null,
          statusCode: response.statusCode,
          responseBody,
          durationMs: Math.round(performance.now() - startedAt),
          receivedAt,
          details: request.requestDetails,
        })
        .catch((error: Error) =>
          this.logger.error(
            `Merchant request ${id} was not logged: ${error.message}`,
            error.stack,
          ),
        );
    });

    next();
  }
}
