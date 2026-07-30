import { Role } from '../../common/enums/role.enum';

const ROLES_ONLY_SUPERADMIN_MAY_ISSUE: Role[] = [Role.Admin, Role.Superadmin];

export const canIssueRole = (issuer: Role, target: Role): boolean => {
  if (issuer === Role.Superadmin) return true;

  if (issuer === Role.Admin) {
    return !ROLES_ONLY_SUPERADMIN_MAY_ISSUE.includes(target);
  }

  return false;
};
