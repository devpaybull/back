import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IsDateFilter } from '../decorators/is-date-filter.decorator';

class Filter {
  @IsDateFilter()
  at: unknown;
}

const valid = (at: unknown): boolean =>
  validateSync(plainToInstance(Filter, { at })).length === 0;

describe('IsDateFilter', () => {
  it('takes a calendar day and an ISO 8601 date-time with Z or an offset', () => {
    expect(valid('2026-10-24')).toBe(true);
    expect(valid('2026-10-24T10:00:00Z')).toBe(true);
    expect(valid('2026-10-24T10:00:00+03:00')).toBe(true);
    expect(valid('2026-10-24T10:00Z')).toBe(true);
    expect(valid('2026-10-24T10:00:00.123Z')).toBe(true);
  });

  it('refuses the reduced and zone-less forms the server would read in its own time zone', () => {
    expect(valid('2026-10')).toBe(false);
    expect(valid('2026')).toBe(false);
    expect(valid('2026-10-26T10:00')).toBe(false);
    expect(valid('2026-10-26T10:00:00')).toBe(false);
  });

  it('takes the years 1970 to 9999 only', () => {
    expect(valid('1970-01-01')).toBe(true);
    expect(valid('9999-12-31')).toBe(true);
    expect(valid('1969-12-31')).toBe(false);
    expect(valid('0001-01-01T00:00:00Z')).toBe(false);
  });

  it('refuses a day that does not exist, a word and a number', () => {
    expect(valid('2026-02-30')).toBe(false);
    expect(valid('yesterday')).toBe(false);
    expect(valid(1729728000000)).toBe(false);
  });
});
