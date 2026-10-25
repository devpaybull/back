import { Fiat } from '../../common/types/fiat';
import { Rate } from '../../common/types/rate';
import { TransactionKind } from './transaction-kind.enum';
import { TransactionMethod } from './transaction-method';

export interface CreateDealInput {
  kind: TransactionKind.PayIn | TransactionKind.PayOut;
  method: TransactionMethod;
  traderUserId: string;
  bankDetailsId: string;
  merchantId: string;
  counterpartyId?: number | null;
  amountFiat: Fiat;
  rate: Rate;
  merchantPercent: number;
  traderPercent: number;
  bankId?: number | null;
  comment?: string | null;
}
