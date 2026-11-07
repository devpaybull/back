import { DealComputation } from './deal-computation';

export interface PricedPayOut extends DealComputation {
  traderPercent: number;
}
