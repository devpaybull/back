import { Rate } from '../../common/types/rate';
import { TransactionKind } from './transaction-kind.enum';

export interface MerchantExchangeRate {
  currency: string;
  type: TransactionKind;
  rate: Rate;
}
