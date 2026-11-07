import { MerchantCallbackEvent } from './merchant-callback-event.enum';

export interface EnqueueMerchantCallback {
  merchantId: string;
  transactionId: string;
  merchantTransactionId: string | null;
  dealCallbackUrl: string | null;
  event: MerchantCallbackEvent;
  eventSeq: number;
  occurredAt: Date;
  payment: unknown;
}
