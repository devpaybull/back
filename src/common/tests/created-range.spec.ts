import { BadRequestException } from '@nestjs/common';
import { DayPeriod } from '../enums/day-period.enum';
import { createdRange } from '../utils/created-range';

const MOSCOW = 'Europe/Moscow';
const DAY_MS = 24 * 60 * 60 * 1000;

describe('createdRange', () => {
  it('is today in the business time zone by default, up to the last millisecond', () => {
    const { createdFrom, createdTo } = createdRange({}, MOSCOW);

    expect(createdTo.getTime() - createdFrom.getTime()).toBe(DAY_MS - 1);
    expect(createdFrom.toISOString()).toMatch(/T21:00:00\.000Z$/);
  });

  it('has no start for all time', () => {
    expect(
      createdRange({ period: DayPeriod.AllTime }, MOSCOW).createdFrom,
    ).toBeUndefined();
  });

  it('reads bare days as midnight in the business time zone', () => {
    expect(
      createdRange(
        { createdFrom: '2026-11-01', createdTo: '2026-11-02' },
        MOSCOW,
      ),
    ).toEqual({
      createdFrom: new Date('2026-10-31T21:00:00Z'),
      createdTo: new Date('2026-11-01T21:00:00Z'),
    });
  });

  it('refuses a period together with dates', () => {
    expect(() =>
      createdRange(
        { period: DayPeriod.Today, createdTo: '2026-11-02' },
        MOSCOW,
      ),
    ).toThrow(BadRequestException);
  });
});
