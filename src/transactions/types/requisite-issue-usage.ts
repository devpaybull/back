import { Fiat } from '../../common/types/fiat';

export interface RequisiteIssueUsage {
  dealsToday: number;
  dealsMonth: number;
  amountToday: Fiat;
  amountMonth: Fiat;
  amountLastHour: Fiat;
  openDeals: number;
  openWithSameAmount: boolean;
  lastDealAt: Date | null;
}
