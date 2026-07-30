import { randomInt } from 'crypto';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_GROUP_COUNT = 4;
const CODE_GROUP_LENGTH = 4;

export const generateInviteCode = (): string =>
  Array.from({ length: CODE_GROUP_COUNT }, () =>
    Array.from(
      { length: CODE_GROUP_LENGTH },
      () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
    ).join(''),
  ).join('');
