import { BadRequestException } from '@nestjs/common';
import { DayPeriod } from '../enums/day-period.enum';
import { dayPeriodRange } from '../utils/day-period-range';

const MOSCOW = 'Europe/Moscow';
const NOW = new Date('2026-11-02T22:30:00Z');

describe('dayPeriodRange', () => {
  it('reads today in the business time zone, not in UTC', () => {
    expect(dayPeriodRange({}, DayPeriod.Today, MOSCOW, NOW)).toEqual({
      from: new Date('2026-11-02T21:00:00Z'),
      to: new Date('2026-11-03T21:00:00Z'),
    });
  });

  it.each([
    [DayPeriod.Yesterday, '2026-11-01T21:00:00Z', '2026-11-02T21:00:00Z'],
    [DayPeriod.Last7Days, '2026-10-27T21:00:00Z', '2026-11-03T21:00:00Z'],
    [DayPeriod.Month, '2026-10-31T21:00:00Z', '2026-11-03T21:00:00Z'],
  ])('%s', (period, from, to) => {
    expect(dayPeriodRange({ period }, DayPeriod.Today, MOSCOW, NOW)).toEqual({
      from: new Date(from),
      to: new Date(to),
    });
  });

  it('all time has no start and ends after today', () => {
    expect(dayPeriodRange({}, DayPeriod.AllTime, MOSCOW, NOW)).toEqual({
      from: null,
      to: new Date('2026-11-03T21:00:00Z'),
    });
  });

  it('a custom range includes both days', () => {
    expect(
      dayPeriodRange(
        { periodFrom: '2026-10-01', periodTo: '2026-10-02' },
        DayPeriod.Today,
        MOSCOW,
        NOW,
      ),
    ).toEqual({
      from: new Date('2026-09-30T21:00:00Z'),
      to: new Date('2026-10-02T21:00:00Z'),
    });
  });

  it('refuses a preset together with a custom range, and half a range', () => {
    expect(() =>
      dayPeriodRange(
        {
          period: DayPeriod.Today,
          periodFrom: '2026-10-01',
          periodTo: '2026-10-02',
        },
        DayPeriod.Today,
        MOSCOW,
        NOW,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      dayPeriodRange(
        { periodFrom: '2026-10-01' },
        DayPeriod.Today,
        MOSCOW,
        NOW,
      ),
    ).toThrow(BadRequestException);
  });
});
