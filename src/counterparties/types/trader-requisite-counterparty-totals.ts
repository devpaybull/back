import { Fiat } from '../../common/types/fiat';

export interface TraderRequisiteCounterpartyTotals {
  bankDetailsId: string;
  bound: number;
  completedCount: number;
  paidCount: number;
  paidAmount: Fiat;
  deposits30d: Fiat;
}
