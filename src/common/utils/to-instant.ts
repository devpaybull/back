import { CALENDAR_DAY_PATTERN } from './calendar-day-pattern';
import { zonedMidnight } from './zoned-midnight';

export function toInstant(value: string, timeZone: string): Date;
export function toInstant(
  value: string | undefined,
  timeZone: string,
): Date | undefined;
export function toInstant(
  value: string | undefined,
  timeZone: string,
): Date | undefined {
  if (value === undefined) return undefined;

  return CALENDAR_DAY_PATTERN.test(value)
    ? zonedMidnight(value, timeZone)
    : new Date(value);
}
