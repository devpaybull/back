import { ActivityAction } from '../../audit/types/activity-action.enum';

export enum BankDetailsAction {
  Updated = 'bank_details.updated',
  Enabled = 'bank_details.enabled',
  Disabled = 'bank_details.disabled',
  Banned = 'bank_details.banned',
  Unbanned = 'bank_details.unbanned',
}

export const REQUISITE_HISTORY_ACTIONS: readonly string[] = [
  ActivityAction.BankDetailsAdded,
  ActivityAction.BankDetailsDeleted,
  ...Object.values(BankDetailsAction),
];
