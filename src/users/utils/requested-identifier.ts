import { BadRequestException } from '@nestjs/common';
import { AccountIdentifier } from '../../common/types/account-identifier';
import { normalizeEmail } from '../../common/utils/normalize-email';
import { normalizeTelegramUsername } from '../../common/utils/normalize-telegram-username';
import { OwnIdentifierChanges } from '../types/own-identifier-changes';

export const IDENTIFIER_CANNOT_BE_CLEARED =
  'An identifier cannot be cleared: omit the field to leave it unchanged';

export const requestedIdentifier = (
  changes: OwnIdentifierChanges,
): AccountIdentifier => {
  const identifier: AccountIdentifier = {};

  if (changes.email !== undefined) {
    identifier.email = normalizeEmail(changes.email);

    if (!identifier.email) {
      throw new BadRequestException(IDENTIFIER_CANNOT_BE_CLEARED);
    }
  }

  if (changes.telegramUsername !== undefined) {
    identifier.telegramUsername = normalizeTelegramUsername(
      changes.telegramUsername,
    );

    if (!identifier.telegramUsername) {
      throw new BadRequestException(IDENTIFIER_CANNOT_BE_CLEARED);
    }
  }

  return identifier;
};
