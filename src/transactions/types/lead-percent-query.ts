import { TraderLead } from '../../users/entities/trader-lead.entity';
import { RateDirection } from './rate-candidate';
import { TransactionMethod } from './transaction-method';

export interface LeadPercentQuery {
  links: TraderLead[];
  method: TransactionMethod;
  amount: number;
  bankId?: number | null;
  direction: RateDirection;
}
