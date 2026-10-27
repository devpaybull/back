import { calendarDateIn } from '../../common/utils/calendar-date-in';
import { zonedMidnight } from '../../common/utils/zoned-midnight';

export function startOfDayIn(
  now: Date,
  timeZone: string,
  dayOfMonth?: number,
): Date {
  const today = calendarDateIn(now, timeZone);
  const day =
    dayOfMonth === undefined
      ? today
      : `${today.slice(0, 8)}${String(dayOfMonth).padStart(2, '0')}`;

  return zonedMidnight(day, timeZone);
}
