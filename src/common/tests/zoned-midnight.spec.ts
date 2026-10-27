import { zonedMidnight } from '../utils/zoned-midnight';

describe('zonedMidnight', () => {
  it('is the instant a calendar day starts in the zone', () => {
    expect(zonedMidnight('2026-10-24', 'Europe/Moscow')).toEqual(
      new Date('2026-10-23T21:00:00Z'),
    );
    expect(zonedMidnight('2026-10-24', 'UTC')).toEqual(
      new Date('2026-10-24T00:00:00Z'),
    );
  });

  it('follows a daylight-saving change', () => {
    expect(zonedMidnight('2026-07-01', 'America/New_York')).toEqual(
      new Date('2026-07-01T04:00:00Z'),
    );
    expect(zonedMidnight('2026-12-01', 'America/New_York')).toEqual(
      new Date('2026-12-01T05:00:00Z'),
    );
  });

  it('reaches a zone east of UTC+12', () => {
    expect(zonedMidnight('2026-10-24', 'Pacific/Kiritimati')).toEqual(
      new Date('2026-10-23T10:00:00Z'),
    );
  });
});

describe('zonedMidnight past 9999', () => {
  it('answers a real moment for the day after 9999-12-31', () => {
    const moment = zonedMidnight('10000-01-01', 'Europe/Moscow');

    expect(Number.isNaN(moment.getTime())).toBe(false);
    expect(moment.toISOString()).toBe('9999-12-31T21:00:00.000Z');
  });
});
