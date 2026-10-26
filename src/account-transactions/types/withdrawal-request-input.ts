import { Crypto } from '../../common/types/crypto';

export interface WithdrawalRequestInput {
  userId: string;
  address: string;
  amount: Crypto;
  totp: string;
}
