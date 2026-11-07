import { Fiat } from '../../common/types/fiat';

export interface RequisiteMatch {
  currency: string;
  amountFiat: Fiat;
  requestedBankId: number | null;
  requestedOperatorId: number | null;
  payerBankId: number | null;
}
