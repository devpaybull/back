import { Crypto } from '../../common/types/crypto';

export interface MerchantDashboardTotals {
  turnover: Crypto;
  creditedPayIn: Crypto;
  payInCommission: Crypto;
  successfulPayInCount: number;
  successfulPayInAmount: Crypto;
}
