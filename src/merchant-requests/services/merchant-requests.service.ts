import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MerchantApiRequest } from '../entities/merchant-api-request.entity';
import { MerchantRequestDetails } from '../types/merchant-request-details';
import { MerchantRequestEntry } from '../types/merchant-request-entry';
import { MerchantRequestResult } from '../types/merchant-request-result.enum';

const API_KEY_HEADER = 'x-secure-key';
const DROPPED_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'cookie',
]);
const KEY_VISIBLE_EDGE = 4;
const ERROR_STATUS_FROM = 400;

const maskKey = (value: string): string =>
  value.length > KEY_VISIBLE_EDGE * 2
    ? `${value.slice(0, KEY_VISIBLE_EDGE)}…${value.slice(-KEY_VISIBLE_EDGE)}`
    : '…';

const errorCodeOf = (body: string | null): string | null => {
  if (body === null) return null;

  try {
    const parsed: unknown = JSON.parse(body);

    return typeof parsed === 'object' &&
      parsed !== null &&
      'code' in parsed &&
      typeof parsed.code === 'string'
      ? parsed.code
      : null;
  } catch {
    return null;
  }
};

const resultOf = (
  details: MerchantRequestDetails,
  failed: boolean,
): MerchantRequestResult => {
  if (details.operation) {
    return failed
      ? MerchantRequestResult.NotCreated
      : MerchantRequestResult.Created;
  }

  return failed ? MerchantRequestResult.Error : MerchantRequestResult.Ok;
};

@Injectable()
export class MerchantRequestsService {
  constructor(
    @InjectRepository(MerchantApiRequest)
    private readonly requests: Repository<MerchantApiRequest>,
    private readonly config: ConfigService,
  ) {}

  async record(entry: MerchantRequestEntry): Promise<void> {
    const request = this.truncate(entry.requestBody);
    const response = this.truncate(entry.responseBody);
    const failed = entry.statusCode >= ERROR_STATUS_FROM;
    const details = entry.details ?? {};

    await this.requests.insert({
      id: entry.id,
      merchantId: entry.merchantId,
      apiKeyId: entry.apiKeyId,
      method: entry.method,
      path: entry.path,
      ip: entry.ip,
      requestHeaders: this.maskHeaders(entry.requestHeaders),
      requestBody: request.text,
      requestBodyTruncated: request.truncated,
      statusCode: entry.statusCode,
      responseBody: response.text,
      responseBodyTruncated: response.truncated,
      errorCode: failed ? errorCodeOf(entry.responseBody) : null,
      durationMs: entry.durationMs,
      result: resultOf(details, failed),
      operation: details.operation ?? null,
      direction: details.direction ?? null,
      paymentMethod: details.paymentMethod ?? null,
      amountFiat: details.amountFiat ?? null,
      currency: details.currency ?? null,
      requestedBankId: details.requestedBankId ?? null,
      payerUserId: details.payerUserId ?? null,
      merchantTransactionId: details.merchantTransactionId ?? null,
      transactionId: details.transactionId ?? null,
      processedByUserId: details.processedByUserId ?? null,
      selectionSummary: details.selectionSummary ?? null,
      receivedAt: entry.receivedAt,
    });
  }

  private maskHeaders(
    headers: MerchantRequestEntry['requestHeaders'],
  ): Record<string, string> {
    const masked: Record<string, string> = {};

    for (const [name, value] of Object.entries(headers)) {
      const key = name.toLowerCase();

      if (value === undefined || DROPPED_HEADERS.has(key)) continue;

      const text = Array.isArray(value) ? value.join(', ') : value;

      masked[key] = key === API_KEY_HEADER ? maskKey(text) : text;
    }

    return masked;
  }

  private truncate(text: string | null): {
    text: string | null;
    truncated: boolean;
  } {
    if (text === null || text === '') return { text: null, truncated: false };

    const max = this.config.get<number>('MERCHANT_REQUEST_LOG_MAX_BYTES');
    const bytes = Buffer.from(text, 'utf8');

    return bytes.length > max
      ? { text: bytes.subarray(0, max).toString('utf8'), truncated: true }
      : { text, truncated: false };
  }
}
