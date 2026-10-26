export enum AccountTransactionStatusReason {
  Expired = 'expired',
  CanceledByUser = 'canceled_by_user',
  RejectedByAdmin = 'rejected_by_admin',
  BelowMinimum = 'below_minimum',
  Unmatched = 'unmatched',
  NetworkFailed = 'network_failed',
  Error = 'error',
}
