import { INestApplication, RawBodyRequest } from '@nestjs/common';
import { json, Request, urlencoded } from 'express';

const MERCHANT_API_PREFIX = '/v1';
const MONEY_FIELDS: ReadonlySet<string> = new Set(['amount']);

const keepMoneySource = (
  key: string,
  value: unknown,
  context?: { source?: string },
): unknown =>
  MONEY_FIELDS.has(key) && typeof value === 'number' && context?.source
    ? context.source
    : value;

export function registerBodyParsers(app: INestApplication): void {
  app.use(
    MERCHANT_API_PREFIX,
    json({
      reviver: keepMoneySource as (key: string, value: unknown) => unknown,
      verify: (request: RawBodyRequest<Request>, _response, buffer) => {
        request.rawBody = buffer;
      },
    }),
  );
  app.use(json());
  app.use(urlencoded({ extended: true }));
}
