import { Fiat } from '../../common/types/fiat';

export interface BankDetailsTurnover {
  total: Fiat;
  today: Fiat;
  month: Fiat;
}
