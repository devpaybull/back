import { isISO8601, ValidateBy, ValidationOptions } from 'class-validator';
import { CALENDAR_DAY_PATTERN } from '../utils/calendar-day-pattern';

const ZONED_DATE_TIME_PATTERN =
  /^(19[7-9]\d|[2-9]\d{3})-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

export const IsDateFilter = (options?: ValidationOptions): PropertyDecorator =>
  ValidateBy(
    {
      name: 'isDateFilter',
      validator: {
        validate: (value: unknown): boolean =>
          typeof value === 'string' &&
          (CALENDAR_DAY_PATTERN.test(value) ||
            ZONED_DATE_TIME_PATTERN.test(value)) &&
          isISO8601(value, { strict: true }) &&
          !Number.isNaN(Date.parse(value)),
        defaultMessage: ({ property }): string =>
          `${property} must be a date (YYYY-MM-DD, midnight in BUSINESS_TIMEZONE) or an ISO 8601 date-time with Z or an offset, years 1970–9999`,
      },
    },
    options,
  );
