import { normalizeEmail } from '../utils/normalize-email';

describe('normalizeEmail', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeEmail('  user@example.com  ')).toBe('user@example.com');
  });

  it('lowercases the whole address', () => {
    expect(normalizeEmail('User@Example.COM')).toBe('user@example.com');
  });

  it('is idempotent', () => {
    expect(normalizeEmail(normalizeEmail(' User@Example.com '))).toBe(
      'user@example.com',
    );
  });

  it('leaves an already normalized address untouched', () => {
    expect(normalizeEmail('user@example.com')).toBe('user@example.com');
  });
});
