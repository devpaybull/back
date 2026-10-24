export interface BankDetailsLimits {
  minAmountEnabled: boolean;
  minAmount: number;
  maxAmountEnabled: boolean;
  maxAmount: number;
  dailyLimitEnabled: boolean;
  dailyLimit: number;
  monthlyLimitEnabled: boolean;
  monthlyLimit: number;
  dailyAmountLimitEnabled: boolean;
  dailyAmountLimit: number;
  monthlyAmountLimitEnabled: boolean;
  monthlyAmountLimit: number;
  maxActiveTransactionsEnabled: boolean;
  maxActiveTransactions: number;
  delayBetweenRequestsEnabled: boolean;
  delayBetweenRequests: number;
}
