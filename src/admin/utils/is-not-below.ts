import {
  isISO8601,
  ValidateBy,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { CALENDAR_DAY_PATTERN } from '../../common/utils/calendar-day-pattern';
import { toDecimal } from '../../common/utils/to-decimal';

const DECIMAL_STRING = /^\d+(\.\d+)?$/;

const isComparable = (value: unknown): boolean =>
  value !== undefined && value !== null && !Number.isNaN(Number(value));

const isDecimalString = (value: unknown): value is string =>
  typeof value === 'string' && DECIMAL_STRING.test(value);

const isDateString = (value: unknown): value is string =>
  typeof value === 'string' &&
  !isDecimalString(value) &&
  isISO8601(value, { strict: true });

const isCalendarDay = (value: string): boolean =>
  CALENDAR_DAY_PATTERN.test(value);

export const IsNotBelow = (
  lowerBoundProperty: string,
  options?: ValidationOptions,
): PropertyDecorator =>
  ValidateBy(
    {
      name: 'isNotBelow',
      constraints: [lowerBoundProperty],
      validator: {
        validate: (value: unknown, args: ValidationArguments): boolean => {
          const lowerBound = (args.object as Record<string, unknown>)[
            lowerBoundProperty
          ];

          if (isDateString(value) && isDateString(lowerBound)) {
            if (isCalendarDay(value) !== isCalendarDay(lowerBound)) return true;

            return isCalendarDay(value)
              ? value >= lowerBound
              : Date.parse(value) >= Date.parse(lowerBound);
          }

          if (!isComparable(value) || !isComparable(lowerBound)) return true;

          if (isDecimalString(value) && isDecimalString(lowerBound)) {
            return toDecimal(value).gte(lowerBound);
          }

          return Number(value) >= Number(lowerBound);
        },
        defaultMessage: (args: ValidationArguments): string =>
          `${args.property} must not be below ${lowerBoundProperty}`,
      },
    },
    options,
  );
