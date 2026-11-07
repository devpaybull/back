import { Injectable } from '@nestjs/common';
import { RankableCandidate } from '../types/rankable-candidate';
import { RequisiteRanking } from '../types/requisite-ranking';

const NEVER = Number.NEGATIVE_INFINITY;

@Injectable()
export class AttachedFirstRanking extends RequisiteRanking {
  rank<C extends RankableCandidate>(candidates: readonly C[]): C[] {
    return [...candidates].sort(
      (a, b) =>
        Number(b.attached) - Number(a.attached) ||
        (a.lastDealAt?.getTime() ?? NEVER) -
          (b.lastDealAt?.getTime() ?? NEVER) ||
        a.bankDetailsId.localeCompare(b.bankDetailsId),
    );
  }
}
