import { isNightWindow } from '../utils/is-night-window';

describe('isNightWindow', () => {
  const start = 0;
  const end = 10;
  const moscow = 'Europe/Moscow';

  it('is night at 03:00 Moscow time', () => {
    expect(
      isNightWindow(new Date('2026-09-02T00:00:00Z'), start, end, moscow),
    ).toBe(true);
  });

  it('is not night at 12:00 Moscow time', () => {
    expect(
      isNightWindow(new Date('2026-09-02T09:00:00Z'), start, end, moscow),
    ).toBe(false);
  });

  it('treats the end hour as exclusive', () => {
    expect(
      isNightWindow(new Date('2026-09-02T07:00:00Z'), start, end, moscow),
    ).toBe(false);
  });

  it('follows the given timezone, not the host', () => {
    const instant = new Date('2026-09-02T05:00:00Z');
    expect(isNightWindow(instant, start, end, 'Europe/Moscow')).toBe(true);
    expect(isNightWindow(instant, start, end, 'Asia/Vladivostok')).toBe(false);
  });
});
