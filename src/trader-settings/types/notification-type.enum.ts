export enum NotificationType {
  NewPayInDeals = 'new_pay_in_deals',
  NewPayouts = 'new_payouts',
  BalanceBelowThreshold = 'balance_below_threshold',
  RequisiteLimitReached = 'requisite_limit_reached',
  RequisiteDisabled = 'requisite_disabled',
  DeviceOffline = 'device_offline',
  DeviceDisabled = 'device_disabled',
  TradingBlocked = 'trading_blocked',
  Antifraud = 'antifraud',
  PayoutTimeoutWarning = 'payout_timeout_warning',
  AutoPayoutFound = 'auto_payout_found',
  AutoPayoutPaused = 'auto_payout_paused',
}

export const NOTIFICATION_TYPES: readonly NotificationType[] =
  Object.values(NotificationType);

export const ALWAYS_ON_NOTIFICATIONS: readonly NotificationType[] = [
  NotificationType.TradingBlocked,
];
