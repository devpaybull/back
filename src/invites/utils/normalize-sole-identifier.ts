import { AccountIdentifier } from '../../common/types/account-identifier';
import { normalizeEmail } from '../../common/utils/normalize-email';
import { normalizeTelegramUsername } from '../../common/utils/normalize-telegram-username';

export const normalizeSoleIdentifier = (
  identifier: AccountIdentifier,
): AccountIdentifier => {
  const email = identifier?.email?.trim();
  const telegramUsername = identifier?.telegramUsername?.trim();

  if (email && !telegramUsername) return { email: normalizeEmail(email) };

  if (telegramUsername && !email) {
    return { telegramUsername: normalizeTelegramUsername(telegramUsername) };
  }

  return null;
};
