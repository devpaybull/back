import { Role } from '../../common/enums/role.enum';
import { AccountIdentifier } from '../../common/types/account-identifier';

export interface RegistrationInput {
  identifier: AccountIdentifier;
  role: Role;
  password: string;
  merchantId?: string | null;
}
