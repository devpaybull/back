import { Fiat } from '../../common/types/fiat';
import { RateDirection } from './rate-candidate';
import { RateScope } from './rate-scope.enum';
import { TransactionMethod } from './transaction-method';

export interface MethodPercentQuery {
  scope: RateScope;
  method: TransactionMethod;
  amount: Fiat;
  bankId?: number | null;
  direction: RateDirection;
  individualEnabled: boolean;
  subjectUserId?: string | null;
  subjectMerchantId?: string | null;
}
