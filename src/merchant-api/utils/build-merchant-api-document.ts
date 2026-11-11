import { INestApplication } from '@nestjs/common';
import {
  CallbacksObject,
  DocumentBuilder,
  getSchemaPath,
  OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { PaymentPageModule } from '../../payment-page/payment-page.module';
import { CallbackPayloadDto } from '../dto/callback-payload.dto';
import { MerchantApiErrorDto } from '../dto/merchant-api-error.dto';
import { MerchantApiModule } from '../merchant-api.module';

const DESCRIPTION = `
The API for a merchant's server (\`/v1\`) and the data of the payer's payment page (\`/pay\`).

## Access

- Every \`/v1\` request carries the key in the **\`X-Secure-Key\`** header. A merchant has one active key;
  issuing a new one revokes the previous at once. No key, an unknown or a revoked one: **401 \`INVALID_API_KEY\`**.
- A disabled merchant gets **403 \`MERCHANT_DISABLED\`** on every request.
- With the IP check on, a request from an address off the merchant's whitelist is **403 \`IP_NOT_ALLOWED\`** —
  except \`POST /v1/payment/pay-out\`, which is not checked against the whitelist.
- \`/pay/{token}\` takes no key: the token, the last segment of the deal's \`paymentPageUrl\`, is the access. Requests
  are limited per client (an IPv6 /64 counts as one client): **429 \`TOO_MANY_REQUESTS\`** with \`Retry-After\`.

Every \`/v1\` answer carries **\`X-Request-Id\`**, the id of the request in the merchant's request history.

## Shapes

- Success: \`{ "data": … }\`; a list: \`{ "data": [ … ], "meta": { "total", "page", "limit", "pages" } }\`.
- Error: \`{ "statusCode", "code", "message", "details"? }\`. \`VALIDATION_FAILED\` lists \`details: [{ field, code }]\`.
- **Money is a decimal string** in every answer: fiat with two decimals (\`"2000.00"\`), USDT and rates with six.
  A request's \`amount\` may be a string or a JSON number; either is read by its decimal text — at most two
  decimals, no sign, no exponent — and never rounded.
- **\`merchantTransactionId\` is the idempotency key.** The same request again answers **200** with the deal it made;
  a different request under a key already used is **409 \`DUPLICATE_MERCHANT_TRANSACTION_ID\`** with that deal in
  \`details.deal\`. A refused creation leaves the key free.
- A pay-in answered with an existing active deal of the same client, method and amount (the "same requests"
  setting) comes with the header **\`X-Same-Request: true\`**.

## Error codes

| Status | Code |
| --- | --- |
| 400 | \`VALIDATION_FAILED\` · \`METHOD_NOT_SUPPORTED\` · \`CURRENCY_MISMATCH\` · \`BANK_NOT_FOUND\` · \`FILE_TYPE_NOT_ALLOWED\` |
| 401 | \`INVALID_API_KEY\` |
| 403 | \`MERCHANT_DISABLED\` · \`IP_NOT_ALLOWED\` · \`METHOD_DISABLED\` · \`AMOUNT_BELOW_MINIMUM\` · \`PAYER_BLOCKED\` · \`FAILED_DEALS_LIMIT\` · \`NO_REQUISITE_FOUND_FOR_THIS_AMOUNT\` · \`RATE_NOT_FOUND\` |
| 404 | \`DEAL_NOT_FOUND\` · \`PAYMENT_PAGE_NOT_FOUND\` |
| 409 | \`DUPLICATE_MERCHANT_TRANSACTION_ID\` · \`INSUFFICIENT_BALANCE\` · \`DEAL_NOT_CANCELABLE\` · \`TIMER_NOT_EXTENDABLE\` · \`DISPUTE_NOT_ALLOWED\` · \`PAYMENT_NOT_PAYABLE\` · \`RECEIPT_LIMIT_REACHED\` |
| 413 | \`FILE_TOO_LARGE\` |
| 429 | \`TOO_MANY_REQUESTS\` · \`TOO_MANY_UPLOADS\` (\`/pay\` only) |
| 500 | \`INTERNAL_ERROR\` |
| 503 | \`RATE_UNAVAILABLE\` |

## Callbacks

A deal made through \`/v1\` reports every status change, every dispute change and a timer extension with a
\`POST\` of \`CallbackPayload\` (JSON) to the deal's \`callbackUrl\`, or, when the request had none, to the
callback URL of the merchant's settings. Creating a deal sends nothing: its answer already said it.

- Headers: **\`X-Signature\`** = hex(HMAC-SHA256(secret, \`X-Timestamp\` + "." + raw body)), where secret is the
  \`secret\` of the merchant's active API key at the moment of sending; **\`X-Timestamp\`** — unix seconds;
  **\`X-Event-Id\`** — the payload's \`eventId\`. Verify the signature over the raw body as received.
- Any 2xx answer is a delivery. Anything else, a timeout or a network error is retried with a growing pause
  (by default 10 attempts: 1, 2, 4, 8, 16, 32, 60, 60, 60 minutes apart), then the callback is failed.
- Delivery is at least once: **deduplicate by \`eventId\`**. Callbacks of one deal go in \`eventSeq\` order; the
  next one waits until the previous is delivered or failed.
- Only \`https\` URLs to public addresses are called, and redirects are not followed.
`;

const SIGNATURE_HEADERS = [
  {
    name: 'X-Signature',
    in: 'header' as const,
    required: true,
    description:
      'hex(HMAC-SHA256(secret of the active API key, X-Timestamp + "." + raw body))',
    schema: { type: 'string' as const },
  },
  {
    name: 'X-Timestamp',
    in: 'header' as const,
    required: true,
    description: 'unix seconds',
    schema: { type: 'string' as const },
  },
  {
    name: 'X-Event-Id',
    in: 'header' as const,
    required: true,
    description: 'the payload’s eventId',
    schema: { type: 'string' as const, format: 'uuid' },
  },
];

const DEAL_CALLBACKS: CallbacksObject = {
  dealEvent: {
    '{$request.body#/callbackUrl}': {
      post: {
        summary: 'A deal event, sent to the merchant',
        description:
          'Sent to the request’s callbackUrl, else to the callback URL of the merchant settings.',
        parameters: SIGNATURE_HEADERS,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: getSchemaPath(CallbackPayloadDto) },
            },
          },
        },
        responses: {
          '2XX': { description: 'Delivered' },
          default: { description: 'Retried later' },
        },
      },
    },
  },
};

const CREATING_PATHS = ['/v1/payment/pay-in', '/v1/payment/pay-out'];

export const buildMerchantApiDocument = (
  app: INestApplication,
): OpenAPIObject => {
  const config = new DocumentBuilder()
    .setTitle('Paybull merchant API')
    .setDescription(DESCRIPTION)
    .setVersion('1')
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'X-Secure-Key' },
      'X-Secure-Key',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    include: [MerchantApiModule, PaymentPageModule],
    extraModels: [CallbackPayloadDto, MerchantApiErrorDto],
  });

  for (const path of CREATING_PATHS) {
    const operation = document.paths[path]?.post;

    if (operation) operation.callbacks = DEAL_CALLBACKS;
  }

  return document;
};
