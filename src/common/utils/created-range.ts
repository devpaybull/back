import { BadRequestException } from '@nestjs/common';
import { DayPeriod } from '../enums/day-period.enum';
import { dayPeriodRange } from './day-period-range';
import { toInstant } from './to-instant';

const LAST_INSTANT_BEFORE_MS = 1;

export function createdRange(
  query: { period?: DayPeriod; createdFrom?: string; createdTo?: string },
  timeZone: string,
): { createdFrom?: Date; createdTo?: Date } {
  const custom =
    query.createdFrom !== undefined || query.createdTo !== undefined;

  if (custom && query.period !== undefined) {
    throw new BadRequestException(
      'period and createdFrom/createdTo cannot be used together',
    );
  }

  if (custom) {
    return {
      createdFrom: toInstant(query.createdFrom, timeZone),
      createdTo: toInstant(query.createdTo, timeZone),
    };
  }

  const { from, to } = dayPeriodRange(
    { period: query.period },
    DayPeriod.Today,
    timeZone,
  );

  return {
    createdFrom: from ?? undefined,
    createdTo: new Date(to.getTime() - LAST_INSTANT_BEFORE_MS),
  };
}
