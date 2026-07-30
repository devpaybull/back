import { Role } from '../../common/enums/role.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { InviteSortField } from './invite-sort-field';
import { InviteStatus } from './invite-status';

export interface InviteListQuery {
  page: number;
  limit: number;
  search?: string;
  sortBy: InviteSortField;
  sortOrder: SortOrder;
  role?: Role;
  status?: InviteStatus;
}
