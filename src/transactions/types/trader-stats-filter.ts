import { TransactionKind } from './transaction-kind.enum';
import { TransactionMethod } from './transaction-method';

export interface TraderStatsFilter {
  kind?: TransactionKind;
  method?: TransactionMethod;
  bankDetailsId?: string;
}
