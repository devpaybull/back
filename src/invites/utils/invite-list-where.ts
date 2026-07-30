import { FindOptionsWhere, ILike } from 'typeorm';
import { escapeLikePattern } from '../../common/utils/escape-like-pattern';
import { Invite } from '../entities/invite.entity';
import { InviteListQuery } from '../types/invite-list-query';
import { inviteStatusConditions } from '../types/invite-status';

export const inviteListWhere = (
  query: InviteListQuery,
): FindOptionsWhere<Invite> | FindOptionsWhere<Invite>[] => {
  const filters: FindOptionsWhere<Invite> = {
    ...(query.role ? { role: query.role } : {}),
    ...(query.status ? inviteStatusConditions(query.status) : {}),
  };

  if (!query.search) return filters;

  const searched = ILike(`%${escapeLikePattern(query.search)}%`);

  return [
    { ...filters, code: searched },
    { ...filters, email: searched },
    { ...filters, telegramUsername: searched },
  ];
};
