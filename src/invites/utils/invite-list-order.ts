import { FindOptionsOrder } from 'typeorm';
import { sortDirection } from '../../common/utils/sort-direction';
import { Invite } from '../entities/invite.entity';
import { InviteListQuery } from '../types/invite-list-query';
import { InviteSortField } from '../types/invite-sort-field';

export const inviteListOrder = (
  query: InviteListQuery,
): FindOptionsOrder<Invite> => {
  const direction = sortDirection(query.sortOrder);

  switch (query.sortBy) {
    case InviteSortField.Id:
      return { id: direction };
    case InviteSortField.CreatedAt:
      return { createdAt: direction, id: direction };
    case InviteSortField.ExpiresAt:
      return { expiresAt: direction, id: direction };
    case InviteSortField.Role:
      return { role: direction, id: direction };
  }
};
