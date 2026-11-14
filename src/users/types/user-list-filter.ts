import { Role } from '../../common/enums/role.enum';
import { UserStatus } from './user-status.enum';

export interface UserListFilter {
  search?: string;
  role?: Role[];
  status?: UserStatus;
  merchantId?: string;
  matchingMerchantIds?: string[];
}
