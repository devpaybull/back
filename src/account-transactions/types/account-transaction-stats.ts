import { Crypto } from '../../common/types/crypto';
import { AccountTransactionStatus } from './account-transaction-status.enum';

export interface AccountTransactionStats {
  byStatus: Record<AccountTransactionStatus, number>;
  belowMinimum: number;
  completedLast24h: { count: number; amount: Crypto };
  finishedLast24h: number;
  staleProcessing: number;
}
