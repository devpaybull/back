import { OpenAPIObject } from '@nestjs/swagger';
import { MerchantApiErrorCode } from '../src/merchant-api/types/merchant-api-error-code.enum';
import { buildMerchantApiDocument } from '../src/merchant-api/utils/build-merchant-api-document';
import { E2eContext, startE2e } from './support/e2e-app';

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

const MERCHANT_PREFIXES = ['/v1/', '/pay/'];
const MIDDLEWARE_WILDCARD = '{*';
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

const isMerchantPath = (path: string): boolean =>
  MERCHANT_PREFIXES.some((prefix) => path.startsWith(prefix));

describe('the merchant OpenAPI document', () => {
  let e2e: E2eContext;
  let document: OpenAPIObject;

  const registeredRoutes = (): string[] => {
    const express = e2e.app.getHttpAdapter().getInstance() as {
      router: { stack: RouteLayer[] };
    };

    return express.router.stack.flatMap(({ route }) =>
      route && !route.path.includes(MIDDLEWARE_WILDCARD)
        ? Object.keys(route.methods).map(
            (method) =>
              `${method.toUpperCase()} ${route.path.replace(/:(\w+)/g, '{$1}')}`,
          )
        : [],
    );
  };

  const documentedOperations = (): string[] =>
    Object.entries(document.paths).flatMap(([path, item]) =>
      HTTP_METHODS.filter((method) => item[method]).map(
        (method) => `${method.toUpperCase()} ${path}`,
      ),
    );

  beforeAll(async () => {
    e2e = await startE2e();
    document = buildMerchantApiDocument(e2e.app);
  });

  afterAll(() => e2e.close());

  it('documents every /v1 and /pay route and nothing else', () => {
    const merchantRoutes = registeredRoutes().filter((route) =>
      isMerchantPath(route.split(' ')[1]),
    );

    expect(merchantRoutes.length).toBeGreaterThanOrEqual(17);
    expect(documentedOperations().sort()).toEqual(merchantRoutes.sort());
    expect(Object.keys(document.paths).every(isMerchantPath)).toBe(true);
  });

  it('leaves out the admin, cabinet, trader and auth surfaces that the app serves', () => {
    const others = registeredRoutes().filter(
      (route) => !isMerchantPath(route.split(' ')[1]),
    );

    expect(others).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/ \/admin\//),
        expect.stringMatching(/ \/merchant\//),
        expect.stringMatching(/ \/trader\//),
        expect.stringMatching(/ \/auth\//),
      ]),
    );
    expect(JSON.stringify(document.paths)).not.toMatch(
      /"\/(admin|merchant|trader|auth|users|device)\//,
    );
  });

  it('declares the X-Secure-Key scheme and requires it on /v1 only', () => {
    expect(document.components?.securitySchemes?.['X-Secure-Key']).toEqual({
      type: 'apiKey',
      in: 'header',
      name: 'X-Secure-Key',
    });

    for (const [path, item] of Object.entries(document.paths)) {
      for (const method of HTTP_METHODS) {
        const operation = item[method];
        if (!operation) continue;

        if (path.startsWith('/v1/')) {
          expect(operation.security).toEqual([{ 'X-Secure-Key': [] }]);
        } else {
          expect(operation.security).toBeUndefined();
        }
        expect(operation.responses.default).toBeDefined();
      }
    }
  });

  it('describes the error body with the whole code catalog', () => {
    const schemas = document.components?.schemas ?? {};
    const error = schemas.MerchantApiErrorDto as {
      properties: Record<string, { $ref?: string }>;
    };
    const codes = schemas.MerchantApiErrorCode as { enum: string[] };

    expect(Object.keys(error.properties)).toEqual(
      expect.arrayContaining(['statusCode', 'code', 'message', 'details']),
    );
    expect(codes.enum.sort()).toEqual(
      Object.values(MerchantApiErrorCode).sort(),
    );
    for (const code of Object.values(MerchantApiErrorCode)) {
      expect(document.info.description).toContain(`\`${code}\``);
    }
  });

  it('describes the callback payload and its signature on both creating operations', () => {
    const payload = document.components?.schemas?.CallbackPayloadDto as {
      properties: Record<string, unknown>;
    };

    expect(Object.keys(payload.properties).sort()).toEqual(
      ['event', 'eventId', 'eventSeq', 'occurredAt', 'payment'].sort(),
    );

    for (const path of ['/v1/payment/pay-in', '/v1/payment/pay-out']) {
      const callback = document.paths[path].post?.callbacks
        ?.dealEvent as Record<
        string,
        { post: { parameters: { name: string }[]; requestBody: unknown } }
      >;
      const post = callback['{$request.body#/callbackUrl}'].post;

      expect(post.parameters.map((header) => header.name)).toEqual([
        'X-Signature',
        'X-Timestamp',
        'X-Event-Id',
      ]);
      expect(JSON.stringify(post.requestBody)).toContain(
        '#/components/schemas/CallbackPayloadDto',
      );
    }
    expect(document.info.description).toContain('HMAC-SHA256');
  });
});
