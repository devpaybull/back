import { startOfDayIn } from './start-of-day-in';

export function startOfMonthIn(now: Date, timeZone: string): Date {
  return startOfDayIn(now, timeZone, 1);
}
