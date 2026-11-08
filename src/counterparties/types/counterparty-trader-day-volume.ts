import { Fiat } from '../../common/types/fiat';

export interface CounterpartyTraderDayVolume {
  counterpartyId: number;
  traderUserId: string;
  day: string;
  paidCount: number;
  paidAmount: Fiat;
}
