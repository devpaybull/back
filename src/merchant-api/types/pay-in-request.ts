import { Fiat } from '../../common/types/fiat';
import { PayerInfo } from '../../transactions/types/payer-info';

export interface PayInRequest {
  method: string;
  amount: Fiat;
  currency?: string;
  merchantTransactionId: string;
  payerInfo: PayerInfo;
  bank?: string;
  payerBank?: string;
  operator?: string;
  callbackUrl?: string;
  successUrl?: string;
  errorUrl?: string;
}
