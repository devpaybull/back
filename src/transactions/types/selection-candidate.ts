import { RequisiteCandidate } from '../../bank-details/types/requisite-candidate';
import { DealCandidate } from './deal-candidate';
import { RankableCandidate } from './rankable-candidate';

export interface SelectionCandidate extends DealCandidate, RankableCandidate {
  requisite: RequisiteCandidate;
  viaBinding: boolean;
  bindsCounterparty: boolean;
}
