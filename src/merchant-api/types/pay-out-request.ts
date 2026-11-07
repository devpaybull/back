import { Fiat } from '../../common/types/fiat';
import { PayerInfo } from '../../transactions/types/payer-info';
import { PayOutRecipient } from './pay-out-recipient';

export interface PayOutRequest {
  method: string;
  amount: Fiat;
  currency?: string;
  merchantTransactionId: string;
  requisite: PayOutRecipient;
  callbackUrl?: string;
  timeoutInMin?: number;
  payerInfo?: PayerInfo;
}
