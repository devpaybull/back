import { windowStartDays } from '../utils/window-start-days';

describe('windowStartDays', () => {
  it('counts today as the last day of each window', () => {
    expect(windowStartDays('2026-11-02')).toEqual({
      since7: '2026-10-27',
      since30: '2026-10-04',
      since60: '2026-09-04',
      since90: '2026-08-05',
    });
  });

  it('crosses a year boundary', () => {
    expect(windowStartDays('2026-01-05')).toEqual({
      since7: '2025-12-30',
      since30: '2025-12-07',
      since60: '2025-11-07',
      since90: '2025-10-08',
    });
  });

  it('handles a leap day inside the window', () => {
    expect(windowStartDays('2028-03-01').since7).toBe('2028-02-24');
  });
});
