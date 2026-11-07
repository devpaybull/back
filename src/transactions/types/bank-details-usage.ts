import { Fiat } from '../../common/types/fiat';

export interface BankDetailsUsage {
  dealsToday: number;
  lastHourAmount: Fiat;
}
