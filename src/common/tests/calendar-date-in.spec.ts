import { calendarDateIn } from '../utils/calendar-date-in';

describe('calendarDateIn', () => {
  it('names the calendar day of an instant in the given zone', () => {
    const instant = new Date('2026-10-26T21:30:00Z');

    expect(calendarDateIn(instant, 'Europe/Moscow')).toBe('2026-10-27');
    expect(calendarDateIn(instant, 'UTC')).toBe('2026-10-26');
  });

  it('pads the month and the day', () => {
    expect(calendarDateIn(new Date('2026-03-05T12:00:00Z'), 'UTC')).toBe(
      '2026-03-05',
    );
  });
});
