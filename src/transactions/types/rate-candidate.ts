export type RateDirection = 'payIn' | 'payOut';

export interface RateCandidate {
  hasSubject: boolean;
  fromAmount: number | null;
  toAmount: number | null;
  bankId: number | null;
  payInPercent: number;
  payOutPercent: number;
}
