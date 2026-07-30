import { User } from '../../users/entities/user.entity';

export const loginOf = (user: User): string =>
  user.email ?? user.telegramUsername;
