import { Fiat } from '../../common/types/fiat';

export interface CounterpartyDealOutcome {
  paid: boolean;
  amountFiat: Fiat;
  resolvedAt: Date;
  traderUserId: string | null;
}
