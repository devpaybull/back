import { FindOptionsWhere, ILike, IsNull, Not } from 'typeorm';
import { escapeLikePattern } from '../../common/utils/escape-like-pattern';
import { BankDetails } from '../entities/bank-details.entity';
import { BankDetailsListQuery } from '../types/bank-details-list-query';

export const bankDetailsListWhere = (
  query: BankDetailsListQuery,
): FindOptionsWhere<BankDetails> | FindOptionsWhere<BankDetails>[] => {
  const filters: FindOptionsWhere<BankDetails> = {
    ...(query.userId !== undefined ? { userId: query.userId } : {}),
    ...(query.bankId !== undefined ? { bankId: query.bankId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.active !== undefined ? { active: query.active } : {}),
    ...(query.banned !== undefined
      ? { bannedAt: query.banned ? Not(IsNull()) : IsNull() }
      : {}),
  };

  if (!query.search) return filters;

  const searched = ILike(`%${escapeLikePattern(query.search)}%`);

  return [
    { ...filters, card: searched },
    { ...filters, phone: searched },
  ];
};
