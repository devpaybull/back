import { BalanceKind } from './balance-kind.enum';
import { BalanceOperationType } from './balance-operation-type.enum';

export interface BalanceOperationFilter {
  userId: string;
  from?: Date;
  to?: Date;
  types?: BalanceOperationType[];
  kind?: BalanceKind;
}
