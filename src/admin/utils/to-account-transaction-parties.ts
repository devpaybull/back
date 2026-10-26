import { loginOf } from '../../common/utils/login-of';
import { User } from '../../users/entities/user.entity';
import { AccountTransactionPartyDto } from '../dto/account-transaction-party.dto';

export const toAccountTransactionParties = (
  users: User[],
): Map<string, AccountTransactionPartyDto> =>
  new Map(
    users.map((user) => [
      user.id,
      {
        id: user.id,
        login: loginOf(user),
        telegramUsername: user.telegramUsername ?? null,
      },
    ]),
  );
