import { TransactionKind } from './transaction-kind.enum';
import { TransactionMethod } from './transaction-method';

export interface CreateDealInput {
  kind: TransactionKind.PayIn | TransactionKind.PayOut;
  method: TransactionMethod;
  traderUserId: string;
  bankDetailsId: string;
  merchantId: string;
  counterpartyId?: number | null;
  amountFiat: number;
  rate: number;
  merchantPercent: number;
  traderPercent: number;
  bankId?: number | null;
  comment?: string | null;
}
