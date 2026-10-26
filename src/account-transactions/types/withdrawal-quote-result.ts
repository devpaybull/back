import { Crypto } from '../../common/types/crypto';

export interface WithdrawalQuoteResult {
  available: Crypto;
  fee: { usdt: Crypto; trx: Crypto };
  maxAmount: Crypto;
  internal: boolean;
  expiresAt: Date;
}
