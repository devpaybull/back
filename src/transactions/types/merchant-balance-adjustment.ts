import { Crypto } from '../../common/types/crypto';

export interface MerchantBalanceAdjustment {
  merchantId: string;
  direction: 'credit' | 'debit';
  amount: Crypto;
  comment: string;
  actorUserId: string;
}
