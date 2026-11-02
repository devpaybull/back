import { WithdrawalRequestInput } from './withdrawal-request-input';

export interface MerchantWithdrawalRequestInput extends WithdrawalRequestInput {
  merchantId: string;
}
