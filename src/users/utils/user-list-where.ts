import { FindOptionsWhere, ILike, In } from 'typeorm';
import { escapeLikePattern } from '../../common/utils/escape-like-pattern';
import { MERCHANT_SIDE_ROLES } from '../../common/utils/merchant-side-roles';
import { User } from '../entities/user.entity';
import { UserListFilter } from '../types/user-list-filter';

export const userListWhere = (
  filter: UserListFilter,
): FindOptionsWhere<User> | FindOptionsWhere<User>[] => {
  const filters: FindOptionsWhere<User> = {
    ...(filter.role?.length ? { role: In(filter.role) } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.merchantId ? { merchantId: filter.merchantId } : {}),
  };

  if (!filter.search) return filters;

  const searched = ILike(`%${escapeLikePattern(filter.search)}%`);
  const merchantRoles = MERCHANT_SIDE_ROLES.filter(
    (role) => !filter.role?.length || filter.role.includes(role),
  );
  const merchantIds = (filter.matchingMerchantIds ?? []).filter(
    (id) => !filter.merchantId || id === filter.merchantId,
  );

  return [
    { ...filters, email: searched },
    { ...filters, telegramUsername: searched },
    ...(merchantRoles.length && merchantIds.length
      ? [
          {
            ...filters,
            role: In(merchantRoles),
            merchantId: In(merchantIds),
          },
        ]
      : []),
  ];
};
