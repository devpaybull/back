import { Fiat } from '../../common/types/fiat';
import { AdminDealCorrection } from './admin-deal-correction';

export interface AdminAmountChange extends AdminDealCorrection {
  amountFiat: Fiat;
}
