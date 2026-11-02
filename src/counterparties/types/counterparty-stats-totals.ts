import { Fiat } from '../../common/types/fiat';

export interface CounterpartyStatsTotals {
  counterpartyId: number;
  dealCount: number;
  completedCount: number;
  paidCount: number;
  disputeCount: number;
  paidAmount: Fiat;
  lastDepositAt: Date | null;
}
