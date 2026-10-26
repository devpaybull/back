import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/token';
import { User } from '../../users/entities/user.entity';
import { canIssueRole } from './can-issue-role';

export const assertMayActOnAccount = (
  admin: AuthenticatedUser,
  target: User | null,
): void => {
  if (!target) throw new NotFoundException('User not found');

  if (target.id === admin.id) {
    throw new ForbiddenException('Cannot act on your own account');
  }

  if (!canIssueRole(admin.role, target.role)) {
    throw new ForbiddenException(`Cannot act on a ${target.role}`);
  }
};
