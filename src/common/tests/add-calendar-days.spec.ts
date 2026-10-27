import { addCalendarDays } from '../utils/add-calendar-days';

describe('addCalendarDays', () => {
  it('moves across a month and a year', () => {
    expect(addCalendarDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addCalendarDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('knows a leap day', () => {
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('leaves the day alone for zero', () => {
    expect(addCalendarDays('2026-10-26', 0)).toBe('2026-10-26');
  });

  it('steps past the last day of 9999 without breaking the format', () => {
    expect(addCalendarDays('9999-12-31', 1)).toBe('10000-01-01');
  });
});
