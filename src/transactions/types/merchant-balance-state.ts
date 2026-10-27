import { Crypto } from '../../common/types/crypto';

export interface MerchantBalanceState {
  balance: Crypto;
  escrow: Crypto;
}
