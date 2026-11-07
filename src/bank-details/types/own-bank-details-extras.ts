import { BankDetailsTurnover } from '../../transactions/types/bank-details-turnover';
import { BankDetailsUsage } from '../../transactions/types/bank-details-usage';
import { BankDetailsTagSummary } from './bank-details-tag-summary';

export interface OwnBankDetailsExtras {
  turnover: BankDetailsTurnover;
  usage: BankDetailsUsage;
  boundCounterparties: number;
  tags: BankDetailsTagSummary[];
}
