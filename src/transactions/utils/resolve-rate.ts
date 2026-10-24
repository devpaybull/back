import { RateCandidate, RateDirection } from '../types/rate-candidate';
import { RateKind } from '../types/rate-kind.enum';

export class NoBaseRateError extends Error {
  constructor() {
    super('No base rate is configured for this scope and method');
    this.name = 'NoBaseRateError';
  }
}

export function resolveRate(params: {
  candidates: RateCandidate[];
  amount: number;
  bankId?: number | null;
  rateKind: RateKind;
  individualEnabled: boolean;
  direction: RateDirection;
}): number {
  const { candidates, amount, rateKind, individualEnabled, direction } = params;
  const bankId = params.bankId ?? null;

  const percentOf = (candidate: RateCandidate) =>
    direction === 'payIn' ? candidate.payInPercent : candidate.payOutPercent;

  const isRange = (candidate: RateCandidate) =>
    candidate.fromAmount !== null && candidate.toAmount !== null;

  const isBankRow = (candidate: RateCandidate) => candidate.bankId !== null;

  const isGeneral = (candidate: RateCandidate) =>
    !isRange(candidate) && !isBankRow(candidate);

  const contains = (candidate: RateCandidate) =>
    amount >= (candidate.fromAmount as number) &&
    amount <= (candidate.toAmount as number);

  const matchesSpecific = (candidate: RateCandidate) =>
    rateKind === RateKind.ByBank
      ? isBankRow(candidate) && bankId !== null && candidate.bankId === bankId
      : isRange(candidate) && !isBankRow(candidate) && contains(candidate);

  if (individualEnabled) {
    const specific = candidates.find(
      (candidate) => candidate.hasSubject && matchesSpecific(candidate),
    );
    if (specific) return percentOf(specific);

    const individualGeneral = candidates.find(
      (candidate) => candidate.hasSubject && isGeneral(candidate),
    );
    if (individualGeneral) return percentOf(individualGeneral);
  }

  const base = candidates.find(
    (candidate) => !candidate.hasSubject && isGeneral(candidate),
  );
  if (!base) throw new NoBaseRateError();

  return percentOf(base);
}
