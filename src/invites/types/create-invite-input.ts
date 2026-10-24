import { Role } from '../../common/enums/role.enum';
import { AccountIdentifier } from '../../common/types/account-identifier';

export interface CreateInviteInput {
  identifier: AccountIdentifier;
  role: Role;
  createdByUserId: string;
  expiresAt?: Date;
  merchantId?: string;
}
