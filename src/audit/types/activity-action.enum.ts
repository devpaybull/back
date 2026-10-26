export enum ActivityAction {
  TradingEnabled = 'activity.trading_enabled',
  TradingDisabled = 'activity.trading_disabled',
  AutoBuybackEnabled = 'activity.auto_buyback_enabled',
  AutoBuybackDisabled = 'activity.auto_buyback_disabled',
  BankDetailsAdded = 'activity.bank_details_added',
  BankDetailsDeleted = 'activity.bank_details_deleted',
  DeviceAdded = 'activity.device_added',
  DeviceDeleted = 'activity.device_deleted',
  DepositCredited = 'activity.deposit_credited',
  WithdrawalCompleted = 'activity.withdrawal_completed',
}

export const ACTIVITY_ACTIONS: readonly ActivityAction[] =
  Object.values(ActivityAction);
