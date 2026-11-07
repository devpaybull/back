import { BankDetails } from '../../bank-details/entities/bank-details.entity';
import { Bank } from '../../banks/entities/bank.entity';

export interface PaymentExtras {
  requisite?: BankDetails | null;
  requestedBank?: Bank | null;
  payoutBank?: Bank | null;
  paymentPageUrl?: string | null;
}
