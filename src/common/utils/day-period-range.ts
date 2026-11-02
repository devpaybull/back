import { BadRequestException } from '@nestjs/common';
import { DayPeriod } from '../enums/day-period.enum';
import { DayPeriodRequest } from '../types/day-period-request';
import { InstantRange } from '../types/instant-range';
import { addCalendarDays } from './add-calendar-days';
import { calendarDateIn } from './calendar-date-in';
import { zonedMidnight } from './zoned-midnight';

export function dayPeriodRange(
  request: DayPeriodRequest,
  fallback: DayPeriod,
  timeZone: string,
  now = new Date(),
): InstantRange {
  const custom =
    request.periodFrom !== undefined || request.periodTo !== undefined;

  if (custom && request.period !== undefined) {
    throw new BadRequestException(
      'period and periodFrom/periodTo cannot be used together',
    );
  }

  if (
    custom &&
    (request.periodFrom === undefined || request.periodTo === undefined)
  ) {
    throw new BadRequestException('periodFrom and periodTo are given together');
  }

  const today = calendarDateIn(now, timeZone);
  const tomorrow = addCalendarDays(today, 1);
  const [first, afterLast] = custom
    ? [
        request.periodFrom as string,
        addCalendarDays(request.periodTo as string, 1),
      ]
    : {
        [DayPeriod.Today]: [today, tomorrow],
        [DayPeriod.Yesterday]: [addCalendarDays(today, -1), today],
        [DayPeriod.Last7Days]: [addCalendarDays(today, -6), tomorrow],
        [DayPeriod.Month]: [`${today.slice(0, 8)}01`, tomorrow],
        [DayPeriod.AllTime]: [null, tomorrow],
      }[request.period ?? fallback];

  return {
    from: first === null ? null : zonedMidnight(first, timeZone),
    to: zonedMidnight(afterLast, timeZone),
  };
}
