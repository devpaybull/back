import { Fiat } from '../../common/types/fiat';

export interface TraderCounterpartyDeposits {
  bankDetailsId: string;
  completedCount: number;
  paidCount: number;
  paidAmount: Fiat;
  deposits30d: Fiat;
}
