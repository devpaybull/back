import { Crypto } from '../../common/types/crypto';

export interface MerchantWithdrawalTotals {
  inProgressAmount: Crypto;
  inProgressCount: number;
  withdrawn: Crypto;
}
