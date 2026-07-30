import { AccountIdentifier } from '../types/account-identifier';
import { normalizeEmail } from './normalize-email';
import { normalizeTelegramUsername } from './normalize-telegram-username';

const FIRST_INDEX_AFTER_TELEGRAM_PREFIX = 1;

export function toAccountIdentifier(login: string): AccountIdentifier {
  const trimmed = login.trim();
  const hasAtBeyondTelegramPrefix =
    trimmed.indexOf('@', FIRST_INDEX_AFTER_TELEGRAM_PREFIX) !== -1;

  return hasAtBeyondTelegramPrefix
    ? { email: normalizeEmail(trimmed) }
    : { telegramUsername: normalizeTelegramUsername(trimmed) };
}
