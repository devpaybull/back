import { Crypto } from '../../common/types/crypto';
import { Fiat } from '../../common/types/fiat';

export interface TraderStatsBucket {
  label: string;
  count: number;
  volumeCrypto: Crypto;
  volumeFiat: Fiat;
}
