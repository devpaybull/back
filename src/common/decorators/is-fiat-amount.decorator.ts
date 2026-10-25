import { ValidateBy, ValidationOptions } from 'class-validator';
import { DecimalAmountOptions } from '../types/decimal-amount-options';
import { FIAT_SCALE } from '../utils/fiat-scale';
import { DECIMAL_AMOUNT_MAX } from '../utils/decimal-amount-max';
import { isDecimalAmount } from '../utils/is-decimal-amount';

export const IsFiatAmount = (
  { positive = false }: DecimalAmountOptions = {},
  options?: ValidationOptions,
): PropertyDecorator =>
  ValidateBy(
    {
      name: 'isFiatAmount',
      constraints: [positive],
      validator: {
        validate: (value: unknown): boolean =>
          isDecimalAmount(value, FIAT_SCALE, positive),
        defaultMessage: ({ property }): string =>
          `${property} must be a decimal string with at most ${FIAT_SCALE} decimal places, ${
            positive ? 'greater than 0' : 'not negative'
          } and not above ${DECIMAL_AMOUNT_MAX}`,
      },
    },
    options,
  );
