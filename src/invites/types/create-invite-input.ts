import { Role } from '../../common/enums/role.enum';

export interface CreateInviteInput {
  telegramUsername: string;
  role: Role;
  createdByUserId: string;
  expiresAt?: Date;
  merchantId?: string;
}
