import { MethodPercent } from '../../transactions/types/method-percent';

export interface InviteTerms {
  rates: MethodPercent[] | null;
  insurancePayInMin: number | null;
}
