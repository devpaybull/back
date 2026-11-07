import { Crypto } from '../../common/types/crypto';
import { BalanceKind } from './balance-kind.enum';

export interface OwnBalanceMove {
  userId: string;
  from: BalanceKind;
  to: BalanceKind;
  amount: Crypto;
  accountTransactionId: number;
  insuranceDelayCheckedAt?: Date;
}
