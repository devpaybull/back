import { parseCorsOrigin } from '../utils/parse-cors-origin';

describe('parseCorsOrigin', () => {
  it('treats an empty value as CORS disabled', () => {
    expect(parseCorsOrigin('')).toBe(false);
    expect(parseCorsOrigin('   ')).toBe(false);
    expect(parseCorsOrigin(undefined)).toBe(false);
  });

  it('treats a lone asterisk as any origin', () => {
    expect(parseCorsOrigin('*')).toBe(true);
    expect(parseCorsOrigin(' * ')).toBe(true);
  });

  it('splits a comma-separated list and trims each origin', () => {
    expect(
      parseCorsOrigin('http://localhost:3000, https://app.example.com'),
    ).toEqual(['http://localhost:3000', 'https://app.example.com']);
  });

  it('drops empty entries left by stray commas', () => {
    expect(parseCorsOrigin('https://app.example.com,,')).toEqual([
      'https://app.example.com',
    ]);
  });

  it('keeps an asterisk inside a list as a literal origin', () => {
    expect(parseCorsOrigin('*,https://app.example.com')).toEqual([
      '*',
      'https://app.example.com',
    ]);
  });
});
