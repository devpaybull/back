import { SelectionSummary } from '../../transactions/types/selection-summary';
import { MerchantRequestSummary } from './merchant-request-summary';

export interface MerchantRequestRecord extends MerchantRequestSummary {
  apiKeyId: number;
  method: string;
  path: string;
  ip: string | null;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  requestBodyTruncated: boolean;
  responseBody: string | null;
  responseBodyTruncated: boolean;
  selectionSummary: SelectionSummary | null;
}
