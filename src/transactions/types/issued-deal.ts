import { Transaction } from '../entities/transaction.entity';
import { DealCandidate } from './deal-candidate';
import { SkippedCandidate } from './skipped-candidate';

export interface IssuedDeal<C extends DealCandidate = DealCandidate> {
  transaction: Transaction | null;
  candidate: C | null;
  skipped: SkippedCandidate<C>[];
}
