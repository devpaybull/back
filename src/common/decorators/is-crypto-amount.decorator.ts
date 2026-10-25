import { ValidateBy, ValidationOptions } from 'class-validator';
import { DecimalAmountOptions } from '../types/decimal-amount-options';
import { CRYPTO_SCALE } from '../utils/crypto-scale';
import { DECIMAL_AMOUNT_MAX } from '../utils/decimal-amount-max';
import { isDecimalAmount } from '../utils/is-decimal-amount';

export const IsCryptoAmount = (
  { positive = false }: DecimalAmountOptions = {},
  options?: ValidationOptions,
): PropertyDecorator =>
  ValidateBy(
    {
      name: 'isCryptoAmount',
      constraints: [positive],
      validator: {
        validate: (value: unknown): boolean =>
          isDecimalAmount(value, CRYPTO_SCALE, positive),
        defaultMessage: ({ property }): string =>
          `${property} must be a decimal string with at most ${CRYPTO_SCALE} decimal places, ${
            positive ? 'greater than 0' : 'not negative'
          } and not above ${DECIMAL_AMOUNT_MAX}`,
      },
    },
    options,
  );
