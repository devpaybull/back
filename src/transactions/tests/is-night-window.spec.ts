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

  describe('a window that spans midnight', () => {
    const wrapStart = 22;
    const wrapEnd = 6;
    const utc = 'UTC';
    const at = (iso: string) =>
      isNightWindow(new Date(iso), wrapStart, wrapEnd, utc);

    it('includes the start hour and the late evening', () => {
      expect(at('2026-09-02T22:00:00Z')).toBe(true);
      expect(at('2026-09-02T23:00:00Z')).toBe(true);
    });

    it('includes the small hours up to the end', () => {
      expect(at('2026-09-03T00:00:00Z')).toBe(true);
      expect(at('2026-09-03T05:59:00Z')).toBe(true);
    });

    it('excludes the end hour and the day', () => {
      expect(at('2026-09-03T06:00:00Z')).toBe(false);
      expect(at('2026-09-02T12:00:00Z')).toBe(false);
      expect(at('2026-09-02T21:59:00Z')).toBe(false);
    });
  });
});
