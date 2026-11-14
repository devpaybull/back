import { PercentRange } from './percent-range';

export interface RateSummary {
  currency: string;
  payIn: PercentRange;
  payOut: PercentRange;
}
