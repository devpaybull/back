import { Crypto } from '../../common/types/crypto';

export interface MerchantPayInStats {
  total: number;
  successful: number;
  turnover: Crypto;
  turnoverCount: number;
}
