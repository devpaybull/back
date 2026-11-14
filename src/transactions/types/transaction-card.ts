import { TransactionDispute } from '../entities/transaction-dispute.entity';
import { TransactionFile } from '../entities/transaction-file.entity';
import { TransactionLeadShare } from '../entities/transaction-lead-share.entity';
import { TransactionStatusEvent } from '../entities/transaction-status-event.entity';
import { Transaction } from '../entities/transaction.entity';
import { AdminDealAction } from './admin-deal-action.enum';

export interface TransactionCard {
  deal: Transaction;
  events: TransactionStatusEvent[];
  disputes: TransactionDispute[];
  leadShares: TransactionLeadShare[];
  files: TransactionFile[];
  actions: AdminDealAction[];
}
