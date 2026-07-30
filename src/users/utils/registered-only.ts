import { FindOptionsWhere, Not } from 'typeorm';
import { User } from '../entities/user.entity';
import { UserStatus } from '../types/user-status.enum';

export const registeredOnly = (
  matches: FindOptionsWhere<User>[],
): FindOptionsWhere<User>[] =>
  matches.map((match) => ({
    ...match,
    status: Not(UserStatus.PendingTwoFactor),
  }));
