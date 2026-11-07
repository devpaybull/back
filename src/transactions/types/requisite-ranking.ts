import { RankableCandidate } from './rankable-candidate';

export abstract class RequisiteRanking {
  abstract rank<C extends RankableCandidate>(candidates: readonly C[]): C[];
}
