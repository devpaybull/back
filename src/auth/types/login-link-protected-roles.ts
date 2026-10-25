import { Role } from '../../common/enums/role.enum';

export const LOGIN_LINK_PROTECTED_ROLES: readonly Role[] = [
  Role.Admin,
  Role.Superadmin,
];
