import { FindOptionsWhere, ILike } from 'typeorm';
import { escapeLikePattern } from '../../common/utils/escape-like-pattern';
import { MobileOperator } from '../entities/mobile-operator.entity';
import { MobileOperatorListQuery } from '../types/mobile-operator-list-query';

export const mobileOperatorListWhere = (
  query: MobileOperatorListQuery,
): FindOptionsWhere<MobileOperator> | FindOptionsWhere<MobileOperator>[] => {
  const filters: FindOptionsWhere<MobileOperator> = {
    ...(query.countryId !== undefined ? { countryId: query.countryId } : {}),
    ...(query.active !== undefined ? { active: query.active } : {}),
  };

  if (!query.search) return filters;

  const searched = ILike(`%${escapeLikePattern(query.search)}%`);

  return [
    { ...filters, code: searched },
    { ...filters, name: searched },
  ];
};
