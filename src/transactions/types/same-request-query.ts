import { Fiat } from '../../common/types/fiat';
import { TransactionMethod } from './transaction-method';

export interface SameRequestQuery {
  merchantId: string;
  counterpartyId: number;
  method: TransactionMethod;
  requestedAmountFiat: Fiat;
}
