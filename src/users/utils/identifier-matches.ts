import { FindOptionsWhere } from 'typeorm';
import { AccountIdentifier } from '../../common/types/account-identifier';
import { User } from '../entities/user.entity';
import { normalizeIdentifier } from './normalize-identifier';

export const identifierMatches = (
  identifier: AccountIdentifier,
): FindOptionsWhere<User>[] => {
  const normalized = normalizeIdentifier(identifier);
  const matches: FindOptionsWhere<User>[] = [];

  if (normalized.email) matches.push({ email: normalized.email });
  if (normalized.telegramUsername)
    matches.push({ telegramUsername: normalized.telegramUsername });

  return matches;
};
