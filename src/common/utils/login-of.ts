import { AccountIdentifier } from '../types/account-identifier';

export const loginOf = (account: AccountIdentifier): string =>
  account.telegramUsername ?? account.email;
