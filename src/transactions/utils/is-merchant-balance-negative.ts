import { HttpException } from '@nestjs/common';
import { MERCHANT_BALANCE_NEGATIVE } from './merchant-balance-negative';

export function isMerchantBalanceNegative(error: HttpException): boolean {
  const response = error.getResponse();

  return (
    typeof response === 'object' &&
    (response as { code?: unknown }).code === MERCHANT_BALANCE_NEGATIVE
  );
}
