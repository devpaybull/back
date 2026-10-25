import { Fiat } from '../../common/types/fiat';

export type RateDirection = 'payIn' | 'payOut';

export interface RateCandidate {
  hasSubject: boolean;
  fromAmount: Fiat | null;
  toAmount: Fiat | null;
  bankId: number | null;
  payInPercent: number;
  payOutPercent: number;
}
