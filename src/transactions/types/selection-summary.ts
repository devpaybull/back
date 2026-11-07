import { SelectionFilter } from './selection-filter.enum';

export interface SelectionSummary {
  considered: number;
  dropped: Partial<Record<SelectionFilter, number>>;
  attempted: number;
  skippedUnderLock: Partial<Record<SelectionFilter, number>>;
  issuedBankDetailsId: string | null;
}
