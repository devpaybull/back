import { startOfDayIn } from '../utils/start-of-day-in';
import { startOfMonthIn } from '../utils/start-of-month-in';

describe('startOfDayIn / startOfMonthIn', () => {
  it('starts a Moscow day at 21:00 UTC of the day before', () => {
    expect(
      startOfDayIn(new Date('2026-03-10T22:30:00Z'), 'Europe/Moscow'),
    ).toEqual(new Date('2026-03-10T21:00:00Z'));
  });

  it('keeps a moment just before Moscow midnight in the same day', () => {
    expect(
      startOfDayIn(new Date('2026-03-10T20:59:59Z'), 'Europe/Moscow'),
    ).toEqual(new Date('2026-03-09T21:00:00Z'));
  });

  it('is the UTC midnight in UTC', () => {
    expect(startOfDayIn(new Date('2026-03-10T23:59:59Z'), 'UTC')).toEqual(
      new Date('2026-03-10T00:00:00Z'),
    );
  });

  it('follows a zone ahead of the date line', () => {
    expect(
      startOfDayIn(new Date('2026-03-10T15:00:00Z'), 'Pacific/Auckland'),
    ).toEqual(new Date('2026-03-10T11:00:00Z'));
  });

  it('starts a month on its first local midnight', () => {
    expect(
      startOfMonthIn(new Date('2026-03-15T12:00:00Z'), 'Europe/Moscow'),
    ).toEqual(new Date('2026-02-28T21:00:00Z'));
  });

  it('puts the late evening of the last UTC day into the next local month', () => {
    expect(
      startOfMonthIn(new Date('2026-03-31T22:00:00Z'), 'Europe/Moscow'),
    ).toEqual(new Date('2026-03-31T21:00:00Z'));
  });

  it('honours a daylight-saving offset', () => {
    expect(
      startOfDayIn(new Date('2026-07-01T12:00:00Z'), 'America/New_York'),
    ).toEqual(new Date('2026-07-01T04:00:00Z'));
  });
});
