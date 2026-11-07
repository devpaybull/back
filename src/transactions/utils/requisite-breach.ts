import { RequisiteCandidate } from '../../bank-details/types/requisite-candidate';
import { RequisiteMatch } from '../types/requisite-match';
import { SelectionFilter } from '../types/selection-filter.enum';

export function requisiteBreach(
  requisite: RequisiteCandidate,
  match: RequisiteMatch,
): SelectionFilter | null {
  if (!requisite.active) return SelectionFilter.RequisiteDisabled;
  if (requisite.banned) return SelectionFilter.RequisiteBanned;
  if (!requisite.deviceOnline) return SelectionFilter.DeviceOffline;
  if (
    requisite.bankCurrency !== null &&
    requisite.bankCurrency !== match.currency
  ) {
    return SelectionFilter.CurrencyMismatch;
  }
  if (
    match.requestedBankId !== null &&
    requisite.bankId !== match.requestedBankId
  ) {
    return SelectionFilter.BankMismatch;
  }
  if (
    match.requestedOperatorId !== null &&
    requisite.mobileOperatorId !== match.requestedOperatorId
  ) {
    return SelectionFilter.OperatorMismatch;
  }
  if (
    requisite.sameBankOnly &&
    (match.payerBankId === null || requisite.bankId !== match.payerBankId)
  ) {
    return SelectionFilter.SameBankOnly;
  }
  if (
    requisite.minAmount !== null &&
    match.amountFiat.lt(requisite.minAmount)
  ) {
    return SelectionFilter.AmountBelowMinimum;
  }
  if (
    requisite.maxAmount !== null &&
    match.amountFiat.gt(requisite.maxAmount)
  ) {
    return SelectionFilter.AmountAboveMaximum;
  }

  return null;
}
