import { FindOptionsWhere, ILike, In } from 'typeorm';
import { escapeLikePattern } from '../../common/utils/escape-like-pattern';
import { User } from '../entities/user.entity';
import { UserListQuery } from '../types/user-list-query';

export const userListWhere = (
  query: UserListQuery,
): FindOptionsWhere<User> | FindOptionsWhere<User>[] => {
  const filters: FindOptionsWhere<User> = {
    ...(query.role?.length ? { role: In(query.role) } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.merchantId ? { merchantId: query.merchantId } : {}),
  };

  if (!query.search) return filters;

  const searched = ILike(`%${escapeLikePattern(query.search)}%`);

  return [
    { ...filters, email: searched },
    { ...filters, telegramUsername: searched },
  ];
};
