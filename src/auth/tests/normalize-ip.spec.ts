import { normalizeIp } from '../utils/normalize-ip';

describe('normalizeIp', () => {
  it.each([
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['::FFFF:203.0.113.7', '203.0.113.7'],
    [' 203.0.113.7 ', '203.0.113.7'],
    ['2001:db8::1', '2001:db8::1'],
    ['203.0.113.7', '203.0.113.7'],
  ])('turns %s into %s', (input, expected) => {
    expect(normalizeIp(input)).toBe(expected);
  });
});
