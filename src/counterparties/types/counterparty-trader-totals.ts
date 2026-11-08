import { Fiat } from '../../common/types/fiat';

export interface CounterpartyTraderTotals {
  counterpartyId: number;
  traderUserId: string;
  completedCount: number;
  paidCount: number;
  paidAmount: Fiat;
  lastPaidAt: Date | null;
  lastDealAt: Date | null;
}
