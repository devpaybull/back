export enum MerchantBalanceOperationType {
  DealPayIn = 'deal_pay_in',
  DealPayOutEscrow = 'deal_pay_out_escrow',
  DealPayOut = 'deal_pay_out',
  DealPayOutEscrowRelease = 'deal_pay_out_escrow_release',
  DealDispute = 'deal_dispute',
  DealCorrection = 'deal_correction',
  AdminAdjustment = 'admin_adjustment',
  WithdrawalHold = 'withdrawal_hold',
  Withdrawal = 'withdrawal',
  WithdrawalRelease = 'withdrawal_release',
}
