export enum MerchantActivityAction {
  Login = 'merchant_activity.login',
  Logout = 'merchant_activity.logout',
  PasswordChanged = 'merchant_activity.password_changed',
  LinksUpdated = 'merchant_activity.links_updated',
  WithdrawalRequested = 'merchant_activity.withdrawal_requested',
  WithdrawalCompleted = 'merchant_activity.withdrawal_completed',
  WithdrawalRejected = 'merchant_activity.withdrawal_rejected',
}

export const MERCHANT_ACTIVITY_ACTIONS: readonly MerchantActivityAction[] =
  Object.values(MerchantActivityAction);
