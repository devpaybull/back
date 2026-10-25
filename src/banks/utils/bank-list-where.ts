import { ArrayContains, FindOptionsWhere, ILike } from 'typeorm';
import { escapeLikePattern } from '../../common/utils/escape-like-pattern';
import { Bank } from '../entities/bank.entity';
import { BankListQuery } from '../types/bank-list-query';

export const bankListWhere = (
  query: BankListQuery,
): FindOptionsWhere<Bank> | FindOptionsWhere<Bank>[] => {
  const filters: FindOptionsWhere<Bank> = {
    ...(query.countryId !== undefined ? { countryId: query.countryId } : {}),
    ...(query.currencyId !== undefined ? { currencyId: query.currencyId } : {}),
    ...(query.transactionType
      ? { transactionTypes: ArrayContains([query.transactionType]) }
      : {}),
    ...(query.active !== undefined ? { active: query.active } : {}),
    ...(query.automatic !== undefined ? { automatic: query.automatic } : {}),
  };

  if (!query.search) return filters;

  const searched = ILike(`%${escapeLikePattern(query.search)}%`);

  return [
    { ...filters, bankId: searched },
    { ...filters, name: searched },
    { ...filters, code: searched },
  ];
};
