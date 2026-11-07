import { DealComputation } from './deal-computation';
import { TransactionStatus } from './transaction-status.enum';

export interface PreparedDeal {
  computation: DealComputation;
  status: TransactionStatus;
  createdAt: Date;
  expiresAt: Date;
}
