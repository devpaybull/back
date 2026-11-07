import { RequisiteCandidate } from '../../bank-details/types/requisite-candidate';
import { Fiat } from '../../common/types/fiat';
import { RequisiteIssueUsage } from '../types/requisite-issue-usage';
import { SelectionFilter } from '../types/selection-filter.enum';

const SECOND_MS = 1000;

export function limitBreach(
  requisite: RequisiteCandidate,
  usage: RequisiteIssueUsage,
  amountFiat: Fiat,
  now: Date,
): SelectionFilter | null {
  const exceeds = (used: Fiat, limit: Fiat | null) =>
    limit !== null && used.plus(amountFiat).gt(limit);

  if (
    requisite.dailyLimit !== null &&
    usage.dealsToday + 1 > requisite.dailyLimit
  ) {
    return SelectionFilter.DailyCount;
  }
  if (
    requisite.monthlyLimit !== null &&
    usage.dealsMonth + 1 > requisite.monthlyLimit
  ) {
    return SelectionFilter.MonthlyCount;
  }
  if (exceeds(usage.amountToday, requisite.dailyAmountLimit)) {
    return SelectionFilter.DailyAmount;
  }
  if (exceeds(usage.amountMonth, requisite.monthlyAmountLimit)) {
    return SelectionFilter.MonthlyAmount;
  }
  if (exceeds(usage.amountLastHour, requisite.hourlyAmountLimit)) {
    return SelectionFilter.HourlyAmount;
  }
  if (
    requisite.maxActiveTransactions !== null &&
    usage.openDeals >= requisite.maxActiveTransactions
  ) {
    return SelectionFilter.MaxActive;
  }
  if (
    requisite.delayBetweenRequestsSeconds !== null &&
    usage.lastDealAt !== null &&
    now.getTime() - usage.lastDealAt.getTime() <
      requisite.delayBetweenRequestsSeconds * SECOND_MS
  ) {
    return SelectionFilter.Delay;
  }
  if (usage.openWithSameAmount) return SelectionFilter.SameAmountActive;

  return null;
}
