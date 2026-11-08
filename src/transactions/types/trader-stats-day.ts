import { Crypto } from '../../common/types/crypto';
import { Fiat } from '../../common/types/fiat';

export interface TraderStatsDay {
  day: string;
  income: Crypto;
  turnover: Fiat;
  paid: number;
  canceled: number;
  created: number;
  disputed: number;
}
