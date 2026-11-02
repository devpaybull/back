import { Fiat } from '../../common/types/fiat';

export interface CounterpartyDayVolume {
  counterpartyId: number;
  day: string;
  paidCount: number;
  paidAmount: Fiat;
}
