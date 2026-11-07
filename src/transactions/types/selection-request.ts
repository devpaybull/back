import { Fiat } from '../../common/types/fiat';
import { Rate } from '../../common/types/rate';
import { MerchantDealFields } from './merchant-deal-fields';
import { TransactionMethod } from './transaction-method';

export interface SelectionRequest extends MerchantDealFields {
  requestId: string | null;
  merchantId: string;
  method: TransactionMethod;
  amountFiat: Fiat;
  rate: Rate;
  merchantPercent: number;
  counterpartyId?: number | null;
  comment?: string | null;
}
