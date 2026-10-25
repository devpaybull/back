import { Role } from '../../common/enums/role.enum';
import { OwnIdentifierChanges } from './own-identifier-changes';
import { UserStatus } from './user-status.enum';

export interface UserChanges extends OwnIdentifierChanges {
  role?: Role;
  password?: string;
  status?: UserStatus;
  telegramId?: string | null;
  telegramGroups?: string | null;
}
