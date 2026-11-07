import { Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { Response } from 'express';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { MerchantRequestLogMiddleware } from '../middleware/merchant-request-log.middleware';
import { MerchantApiRequest } from '../types/merchant-api-request';

const MERCHANT = uuidOf(1);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const build = (record = jest.fn(async () => undefined)) => {
  const middleware = new MerchantRequestLogMiddleware({ record } as never);
  const sent: unknown[] = [];
  const response = Object.assign(new EventEmitter(), {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    send(body?: unknown) {
      sent.push(body);
      return this;
    },
  });
  const request = {
    method: 'POST',
    originalUrl: '/v1/merchant/balance?x=1',
    ip: '203.0.113.7',
    headers: { 'x-secure-key': 'k' },
    rawBody: Buffer.from('{"amount":2000}'),
  } as unknown as MerchantApiRequest;
  const next = jest.fn();

  middleware.use(request, response as unknown as Response, next);

  return { request, response, record, sent, next };
};

describe('MerchantRequestLogMiddleware', () => {
  it('sets a uuid X-Request-Id before the handler runs', () => {
    const { response, next } = build();

    expect(response.headers['X-Request-Id']).toMatch(UUID);
    expect(next).toHaveBeenCalled();
  });

  it('records an identified merchant’s request with the final status and body, under the header’s id', async () => {
    const { request, response, record, sent } = build();

    request.apiMerchant = { merchantId: MERCHANT, apiKeyId: 3 };
    response.statusCode = 403;
    (response as unknown as Response).send('{"code":"IP_NOT_ALLOWED"}');
    response.emit('finish');
    await Promise.resolve();

    expect(sent).toEqual(['{"code":"IP_NOT_ALLOWED"}']);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        id: response.headers['X-Request-Id'],
        merchantId: MERCHANT,
        apiKeyId: 3,
        method: 'POST',
        path: '/v1/merchant/balance?x=1',
        ip: '203.0.113.7',
        requestHeaders: { 'x-secure-key': 'k' },
        requestBody: '{"amount":2000}',
        statusCode: 403,
        responseBody: '{"code":"IP_NOT_ALLOWED"}',
        receivedAt: expect.any(Date),
        durationMs: expect.any(Number),
      }),
    );
  });

  it('hands the handler the row id and records the details the handler left on the request', async () => {
    const { request, response, record } = build();

    expect(request.requestId).toBe(response.headers['X-Request-Id']);
    request.apiMerchant = { merchantId: MERCHANT, apiKeyId: 3 };
    request.requestDetails = { transactionId: uuidOf(9) };
    response.statusCode = 201;
    response.emit('finish');
    await Promise.resolve();

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ details: { transactionId: uuidOf(9) } }),
    );
  });

  it('keeps the address the request arrived with, since a closed socket no longer has one on finish', async () => {
    const { request, response, record } = build();

    request.apiMerchant = { merchantId: MERCHANT, apiKeyId: 3 };
    Object.assign(request, { ip: undefined });
    response.emit('finish');
    await Promise.resolve();

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ ip: '203.0.113.7' }),
    );
  });

  it('still records the request when it arrived with no address', async () => {
    const record = jest.fn(async () => undefined);
    const middleware = new MerchantRequestLogMiddleware({ record } as never);
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200,
      setHeader: jest.fn(),
      send: jest.fn(),
    });
    const request = {
      method: 'GET',
      originalUrl: '/v1/merchant/balance',
      headers: {},
      apiMerchant: { merchantId: MERCHANT, apiKeyId: 3 },
    } as unknown as MerchantApiRequest;

    middleware.use(request, response as unknown as Response, jest.fn());
    response.emit('finish');
    await Promise.resolve();

    expect(record).toHaveBeenCalledWith(expect.objectContaining({ ip: null }));
  });

  it('records nothing for a request whose key identified nobody', () => {
    const { response, record } = build();

    response.statusCode = 401;
    response.emit('finish');

    expect(record).not.toHaveBeenCalled();
  });

  it('swallows a failed write and logs it', async () => {
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const record = jest.fn(async () => {
      throw new Error('db down');
    });
    const { request, response } = build(record);

    request.apiMerchant = { merchantId: MERCHANT, apiKeyId: 3 };
    expect(() => response.emit('finish')).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));

    expect(record).toHaveBeenCalled();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
