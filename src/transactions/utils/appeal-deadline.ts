import { addCalendarDays } from '../../common/utils/add-calendar-days';
import { calendarDateIn } from '../../common/utils/calendar-date-in';
import { zonedMidnight } from '../../common/utils/zoned-midnight';
import { isNightWindow } from './is-night-window';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export interface AppealNight {
  startHour: number;
  endHour: number;
  graceMinutes: number;
  timeZone: string;
}

export function appealDeadline(
  from: Date,
  responseMinutes: number,
  night: AppealNight,
): Date {
  const deadline = new Date(from.getTime() + responseMinutes * MINUTE_MS);

  if (
    !isNightWindow(deadline, night.startHour, night.endHour, night.timeZone)
  ) {
    return deadline;
  }

  const day = calendarDateIn(deadline, night.timeZone);
  const endOn = (date: string): number =>
    zonedMidnight(date, night.timeZone).getTime() +
    night.endHour * HOUR_MS +
    night.graceMinutes * MINUTE_MS;
  const endToday = endOn(day);

  return new Date(
    endToday > deadline.getTime() ? endToday : endOn(addCalendarDays(day, 1)),
  );
}
