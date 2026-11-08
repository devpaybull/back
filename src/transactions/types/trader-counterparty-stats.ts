import { Fiat } from '../../common/types/fiat';

export interface TraderCounterpartyStats {
  id: number;
  bankDetailsId: string;
  active: boolean;
  completedCount: number;
  paidCount: number;
  paidAmount: Fiat;
  lastDealAt: Date | null;
}
