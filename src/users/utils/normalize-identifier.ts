import { AccountIdentifier } from '../../common/types/account-identifier';
import { normalizeEmail } from '../../common/utils/normalize-email';
import { normalizeTelegramUsername } from '../../common/utils/normalize-telegram-username';

export const normalizeIdentifier = (
  identifier: AccountIdentifier,
): AccountIdentifier => ({
  ...(identifier.email ? { email: normalizeEmail(identifier.email) } : {}),
  ...(identifier.telegramUsername
    ? {
        telegramUsername: normalizeTelegramUsername(
          identifier.telegramUsername,
        ),
      }
    : {}),
});
