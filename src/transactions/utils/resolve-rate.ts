import { RateCandidate, RateDirection } from '../types/rate-candidate';

export class NoBaseRateError extends Error {
  constructor() {
    super('No base rate is configured for this scope and method');
    this.name = 'NoBaseRateError';
  }
}

export function resolveRate(params: {
  candidates: RateCandidate[];
  amount: number;
  individualEnabled: boolean;
  direction: RateDirection;
}): number {
  const { candidates, amount, individualEnabled, direction } = params;

  const percentOf = (candidate: RateCandidate) =>
    direction === 'payIn' ? candidate.payInPercent : candidate.payOutPercent;

  const isRange = (candidate: RateCandidate) =>
    candidate.fromAmount !== null && candidate.toAmount !== null;

  const contains = (candidate: RateCandidate) =>
    amount >= (candidate.fromAmount as number) &&
    amount <= (candidate.toAmount as number);

  if (individualEnabled) {
    const matchedRange = candidates.find(
      (candidate) =>
        candidate.hasSubject && isRange(candidate) && contains(candidate),
    );
    if (matchedRange) return percentOf(matchedRange);

    const individualGeneral = candidates.find(
      (candidate) => candidate.hasSubject && !isRange(candidate),
    );
    if (individualGeneral) return percentOf(individualGeneral);
  }

  const base = candidates.find(
    (candidate) => !candidate.hasSubject && !isRange(candidate),
  );
  if (!base) throw new NoBaseRateError();

  return percentOf(base);
}
