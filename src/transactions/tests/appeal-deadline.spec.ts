import { appealDeadline } from '../utils/appeal-deadline';

const NIGHT = {
  startHour: 0,
  endHour: 10,
  graceMinutes: 30,
  timeZone: 'Europe/Moscow',
};

describe('appealDeadline', () => {
  it.each([
    ['by day', '2026-11-07T12:00:00+03:00', '2026-11-07T12:30:00+03:00'],
    [
      'the evening before midnight',
      '2026-11-07T23:00:00+03:00',
      '2026-11-07T23:30:00+03:00',
    ],
    [
      'falling into the night',
      '2026-11-07T23:45:00+03:00',
      '2026-11-08T10:30:00+03:00',
    ],
    [
      'at the start of the night',
      '2026-11-07T23:30:00+03:00',
      '2026-11-08T10:30:00+03:00',
    ],
    [
      'deep in the night',
      '2026-11-08T03:00:00+03:00',
      '2026-11-08T10:30:00+03:00',
    ],
    [
      'the last night minute',
      '2026-11-08T09:29:00+03:00',
      '2026-11-08T10:30:00+03:00',
    ],
    [
      'ending right at the end of the night',
      '2026-11-08T09:30:00+03:00',
      '2026-11-08T10:00:00+03:00',
    ],
    [
      'just after the night',
      '2026-11-08T09:45:00+03:00',
      '2026-11-08T10:15:00+03:00',
    ],
  ])('%s', (_name, from, expected) => {
    expect(appealDeadline(new Date(from), 30, NIGHT)).toEqual(
      new Date(expected),
    );
  });

  it('a night that crosses midnight ends on the next morning before midnight', () => {
    expect(
      appealDeadline(new Date('2026-11-07T22:30:00+03:00'), 30, {
        ...NIGHT,
        startHour: 22,
        endHour: 6,
      }),
    ).toEqual(new Date('2026-11-08T06:30:00+03:00'));
  });
});
