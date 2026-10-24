import { UserStatus } from './user-status.enum';

export const AUTHENTICATABLE_STATUSES: readonly UserStatus[] = [
  UserStatus.Active,
  UserStatus.Suspended,
];
