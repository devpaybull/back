import { Fiat } from '../../common/types/fiat';

export interface BankDetailsLimits {
  minAmountEnabled: boolean;
  minAmount: Fiat;
  maxAmountEnabled: boolean;
  maxAmount: Fiat;
  dailyLimitEnabled: boolean;
  dailyLimit: number;
  monthlyLimitEnabled: boolean;
  monthlyLimit: number;
  dailyAmountLimitEnabled: boolean;
  dailyAmountLimit: Fiat;
  monthlyAmountLimitEnabled: boolean;
  monthlyAmountLimit: Fiat;
  maxActiveTransactionsEnabled: boolean;
  maxActiveTransactions: number;
  delayBetweenRequestsEnabled: boolean;
  delayBetweenRequests: number;
}
