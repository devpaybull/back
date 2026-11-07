import { Crypto } from '../../common/types/crypto';
import { BalanceKind } from '../../transactions/types/balance-kind.enum';

export interface OwnBalanceTransferInput {
  userId: string;
  from: BalanceKind;
  to: BalanceKind;
  amount: Crypto;
  actorUserId: string;
  impersonatorUserId?: string | null;
  comment?: string | null;
  insuranceDelayCheckedAt?: Date;
}
