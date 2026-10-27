import { Fiat } from '../../common/types/fiat';
import { TransactionKind } from './transaction-kind.enum';

export interface MerchantMethodVolume {
  merchantId: string;
  method: string;
  kind: TransactionKind;
  volume: Fiat;
}
