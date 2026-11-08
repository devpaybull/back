import { ExecutionContext, HttpException } from '@nestjs/common';
import { PayPageRateLimitGuard } from '../guards/pay-page-rate-limit.guard';

describe('PayPageRateLimitGuard', () => {
  const START = new Date('2026-11-07T10:00:00Z').getTime();
  let now = START;

  beforeEach(() => {
    now = START;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => jest.restoreAllMocks());

  const build = (limit: number) =>
    new PayPageRateLimitGuard({ getOrThrow: () => limit } as never);

  const call = (guard: PayPageRateLimitGuard, ip: string | undefined) => {
    const headers: Record<string, string> = {};
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ ip }),
        getResponse: () => ({
          setHeader: (name: string, value: string) => (headers[name] = value),
        }),
      }),
    } as unknown as ExecutionContext;

    try {
      return { passed: guard.canActivate(context), headers };
    } catch (error) {
      return { passed: false, error: error as HttpException, headers };
    }
  };

  it('lets the limit through within a minute and answers the next one 429 with Retry-After', () => {
    const guard = build(3);

    for (let i = 0; i < 3; i++)
      expect(call(guard, '203.0.113.7').passed).toBe(true);

    now += 15_000;
    const refused = call(guard, '203.0.113.7');

    expect(refused.passed).toBe(false);
    expect(refused.error?.getStatus()).toBe(429);
    expect(refused.error?.getResponse()).toEqual({
      statusCode: 429,
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many requests; try again in a minute',
    });
    expect(refused.headers['Retry-After']).toBe('45');
  });

  it('counts each client address on its own', () => {
    const guard = build(1);

    expect(call(guard, '203.0.113.7').passed).toBe(true);
    expect(call(guard, '203.0.113.8').passed).toBe(true);
    expect(call(guard, '203.0.113.7').passed).toBe(false);
  });

  it('opens a new window a minute after the first request', () => {
    const guard = build(1);

    expect(call(guard, '203.0.113.7').passed).toBe(true);
    expect(call(guard, '203.0.113.7').passed).toBe(false);
    now += 60_000;
    expect(call(guard, '203.0.113.7').passed).toBe(true);
  });

  it('keeps refused requests counted, so hammering does not reopen the window early', () => {
    const guard = build(1);

    call(guard, '203.0.113.7');
    for (let i = 0; i < 5; i++) {
      now += 10_000;
      expect(call(guard, '203.0.113.7').passed).toBe(false);
    }
  });

  it('puts requests without an address into one shared bucket', () => {
    const guard = build(1);

    expect(call(guard, undefined).passed).toBe(true);
    expect(call(guard, undefined).passed).toBe(false);
  });

  it('forgets clients whose window ended', () => {
    const guard = build(1);

    call(guard, '203.0.113.7');
    now += 60_000;
    call(guard, '203.0.113.8');

    expect(
      (guard as unknown as { windows: Map<string, unknown> }).windows.has(
        '203.0.113.7',
      ),
    ).toBe(false);
  });

  it('counts every address of one IPv6 /64 as one client', () => {
    const guard = build(1);

    expect(call(guard, '2001:db8:1:2::1').passed).toBe(true);
    expect(call(guard, '2001:db8:1:2:ffff::9').passed).toBe(false);
    expect(call(guard, '2001:db8:1:3::1').passed).toBe(true);
  });

  it('keeps at most 100 000 clients, dropping the oldest window first', () => {
    const guard = build(1);
    const windows = (guard as unknown as { windows: Map<string, unknown> })
      .windows;

    for (let i = 0; i < 100_000; i++) {
      call(guard, `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`);
    }
    expect(windows.size).toBe(100_000);

    call(guard, '203.0.113.7');

    expect(windows.size).toBe(100_000);
    expect(windows.has('10.0.0.0')).toBe(false);
    expect(windows.has('203.0.113.7')).toBe(true);
  });

  it('moves a renewed window to the end, so the sweep stops at the first live one', () => {
    const guard = build(5);
    const windows = (guard as unknown as { windows: Map<string, unknown> })
      .windows;

    call(guard, '203.0.113.7');
    now += 30_000;
    call(guard, '203.0.113.8');
    now += 31_000;
    call(guard, '203.0.113.7');

    expect([...windows.keys()]).toEqual(['203.0.113.8', '203.0.113.7']);
  });
});
