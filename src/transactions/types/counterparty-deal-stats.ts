import { Fiat } from '../../common/types/fiat';

export interface CounterpartyDealStats {
  dealCount: number;
  completedCount: number;
  paidCount: number;
  disputeCount: number;
  paidAmount: Fiat;
  lastDepositAt: Date | null;
  volume7d: Fiat;
  volume30d: Fiat;
}
