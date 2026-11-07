import { Fiat } from '../../common/types/fiat';
import { Rate } from '../../common/types/rate';
import { PayerInfo } from './payer-info';
import { TransactionMethod } from './transaction-method';

export interface PayOutRequestInput {
  method: TransactionMethod;
  merchantId: string;
  merchantTransactionId: string;
  amountFiat: Fiat;
  rate: Rate;
  merchantPercent: number;
  windowMinutes: number | null;
  payoutOwnerName: string;
  payoutBankId: number;
  payoutCardNumber: string | null;
  payoutPhone: string | null;
  payerInfo: PayerInfo | null;
  callbackUrl: string | null;
}
