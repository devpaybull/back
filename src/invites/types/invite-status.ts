import {
  FindOptionsWhere,
  IsNull,
  LessThanOrEqual,
  MoreThan,
  Not,
} from 'typeorm';
import { Invite } from '../entities/invite.entity';

export enum InviteStatus {
  Pending = 'pending',
  Used = 'used',
  Revoked = 'revoked',
  Expired = 'expired',
}

export const inviteStatus = (
  invite: Invite,
  now = new Date(),
): InviteStatus => {
  if (invite.usedAt) return InviteStatus.Used;
  if (invite.revokedAt) return InviteStatus.Revoked;
  if (invite.expiresAt.getTime() <= now.getTime()) return InviteStatus.Expired;

  return InviteStatus.Pending;
};

export const inviteStatusConditions = (
  status: InviteStatus,
  now = new Date(),
): FindOptionsWhere<Invite> => {
  switch (status) {
    case InviteStatus.Used:
      return { usedAt: Not(IsNull()) };
    case InviteStatus.Revoked:
      return { usedAt: IsNull(), revokedAt: Not(IsNull()) };
    case InviteStatus.Expired:
      return {
        usedAt: IsNull(),
        revokedAt: IsNull(),
        expiresAt: LessThanOrEqual(now),
      };
    case InviteStatus.Pending:
      return {
        usedAt: IsNull(),
        revokedAt: IsNull(),
        expiresAt: MoreThan(now),
      };
  }
};
