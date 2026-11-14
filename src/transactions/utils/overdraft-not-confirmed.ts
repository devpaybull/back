import { ConflictException } from '@nestjs/common';
import { formatCrypto } from '../../common/utils/format-crypto';
import { OverdraftShortfall } from '../types/overdraft-shortfall';

export function overdraftNotConfirmed(
  shortfalls: readonly OverdraftShortfall[],
): ConflictException {
  return new ConflictException({
    statusCode: 409,
    code: 'OVERDRAFT_NOT_CONFIRMED',
    message:
      'This action takes a balance below zero; repeat it with confirmOverdraft: true',
    shortfalls: shortfalls.map((item) => ({
      party: item.party,
      id: item.id,
      shortfall: formatCrypto(item.shortfall),
    })),
  });
}
