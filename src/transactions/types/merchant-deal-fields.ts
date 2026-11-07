import { Fiat } from '../../common/types/fiat';
import { PayerInfo } from './payer-info';

export interface MerchantDealFields {
  merchantTransactionId?: string | null;
  payerInfo?: PayerInfo | null;
  requestedBankId?: number | null;
  requestedOperatorId?: number | null;
  payerBankId?: number | null;
  callbackUrl?: string | null;
  successUrl?: string | null;
  errorUrl?: string | null;
  requestedAmountFiat?: Fiat | null;
}
