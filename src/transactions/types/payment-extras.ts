import { BankDetails } from '../../bank-details/entities/bank-details.entity';
import { Bank } from '../../banks/entities/bank.entity';
import { TransactionDispute } from '../entities/transaction-dispute.entity';
import { TransactionFile } from '../entities/transaction-file.entity';

export interface PaymentExtras {
  requisite?: BankDetails | null;
  requestedBank?: Bank | null;
  payoutBank?: Bank | null;
  paymentPageUrl?: string | null;
  dispute?: TransactionDispute | null;
  disputeFiles?: readonly TransactionFile[];
}
