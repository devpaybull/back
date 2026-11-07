import { MerchantCallbackStatus } from './merchant-callback-status.enum';

export interface CallbackAttemptOutcome {
  status: MerchantCallbackStatus;
  lastError: string | null;
  nextAttemptAt: Date | null;
  lastResponseCode?: number;
  lastResponseBody?: string;
}
