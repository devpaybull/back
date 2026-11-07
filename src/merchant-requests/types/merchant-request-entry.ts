import { MerchantRequestDetails } from './merchant-request-details';

export interface MerchantRequestEntry {
  id: string;
  merchantId: string;
  apiKeyId: number;
  method: string;
  path: string;
  ip: string | null;
  requestHeaders: Record<string, string | string[] | undefined>;
  requestBody: string | null;
  statusCode: number;
  responseBody: string | null;
  durationMs: number;
  receivedAt: Date;
  details?: MerchantRequestDetails;
}
