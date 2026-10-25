import { UserStatus } from '../../users/types/user-status.enum';
import { Role } from '../enums/role.enum';

export enum TokenType {
  Access = 'access',
  Refresh = 'refresh',
  Registration = 'registration',
  TwoFactorSetup = 'two_factor_setup',
}

export interface AccessTokenPayload {
  sub: string;
  sid: number;
  login: string;
  role: Role;
  type: TokenType.Access;
}

export interface AuthenticatedUser {
  id: string;
  login: string;
  role: Role;
  status: UserStatus;
  impersonatedBy?: string | null;
}
