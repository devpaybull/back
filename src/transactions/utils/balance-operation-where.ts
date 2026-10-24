import { And, FindOptionsWhere, In, LessThan, MoreThanOrEqual } from 'typeorm';
import { BalanceOperation } from '../entities/balance-operation.entity';
import { BalanceOperationFilter } from '../types/balance-operation-filter';

const createdAtRange = ({ from, to }: BalanceOperationFilter) => {
  if (from && to) return And(MoreThanOrEqual(from), LessThan(to));
  if (from) return MoreThanOrEqual(from);
  if (to) return LessThan(to);

  return undefined;
};

export const balanceOperationWhere = (
  walletId: number,
  filter: BalanceOperationFilter,
): FindOptionsWhere<BalanceOperation> => ({
  walletId,
  ...(createdAtRange(filter) ? { createdAt: createdAtRange(filter) } : {}),
  ...(filter.types && filter.types.length > 0
    ? { type: In(filter.types) }
    : {}),
  ...(filter.kind ? { balanceKind: filter.kind } : {}),
});
