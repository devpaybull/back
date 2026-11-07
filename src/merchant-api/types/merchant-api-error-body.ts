import { MerchantApiErrorCode } from './merchant-api-error-code.enum';

export interface MerchantApiErrorBody {
  statusCode: number;
  code: MerchantApiErrorCode;
  message: string;
  details?: unknown;
}
