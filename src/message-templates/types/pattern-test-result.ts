import { Fiat } from '../../common/types/fiat';

export interface PatternTestResult {
  matched: boolean;
  amount: Fiat | null;
}
