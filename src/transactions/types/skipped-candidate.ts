import { DealCandidate } from './deal-candidate';
import { SelectionFilter } from './selection-filter.enum';

export interface SkippedCandidate<C extends DealCandidate = DealCandidate> {
  candidate: C;
  reason: SelectionFilter;
}
