import { Fiat } from '../../common/types/fiat';
import { RateDirection } from './rate-candidate';
import { RateScope } from './rate-scope.enum';
import { TransactionMethod } from './transaction-method';

export interface SubjectPercentQuery {
  scope: RateScope.Trader;
  method: TransactionMethod;
  amount: Fiat;
  direction: RateDirection;
}
