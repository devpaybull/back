import { TransactionKind } from './transaction-kind.enum';
import { TransactionMethod } from './transaction-method.enum';

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
  leadPercent?: number | null;
  comment?: string | null;
}
