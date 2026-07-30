import { normalizeTelegramUsername } from '../utils/normalize-telegram-username';

describe('normalizeTelegramUsername', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeTelegramUsername('  durov  ')).toBe('durov');
  });

  it('drops the leading at sign', () => {
    expect(normalizeTelegramUsername('@durov')).toBe('durov');
  });

  it('drops the leading at sign left behind whitespace', () => {
    expect(normalizeTelegramUsername('  @durov ')).toBe('durov');
  });

  it('drops only a single leading at sign', () => {
    expect(normalizeTelegramUsername('@@durov')).toBe('@durov');
  });

  it('lowercases the username', () => {
    expect(normalizeTelegramUsername('@Durov')).toBe('durov');
  });

  it('is idempotent', () => {
    expect(
      normalizeTelegramUsername(normalizeTelegramUsername(' @Durov ')),
    ).toBe('durov');
  });
});
